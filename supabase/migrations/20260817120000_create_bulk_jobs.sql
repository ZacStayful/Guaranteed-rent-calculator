-- Durable job model for the admin bulk property upload.
--
-- A bulk job runs one spreadsheet row through the SAME analyser pipeline a
-- single live run uses, then writes the result and PDF to the row's matched
-- Monday item. Each row costs roughly £0.50 of Airbtics credit and writes
-- irreversibly to the CRM, so the two properties that matter here are:
--
--   1. A row is processed AT MOST once. Rows are claimed with
--      FOR UPDATE SKIP LOCKED, so overlapping cron ticks and self-chained
--      invocations get disjoint sets and Postgres does the arbitration.
--   2. The job survives anything. All state is in these tables, never in
--      process memory, and a claim that goes stale is reclaimed — so a
--      function killed mid-row resumes rather than stalling the batch.

create table if not exists bulk_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    text,                                   -- admin email
  filename      text,
  status        text not null default 'draft',
    -- draft | running | paused | completed | cancelled
  total_rows    int  not null default 0,
  runnable_rows int  not null default 0,
  -- Which spreadsheet column was used for each field, so the preview can show
  -- and correct a mis-detected header.
  header_map    jsonb,
  -- Why a job auto-paused (e.g. the consecutive-failure circuit breaker).
  paused_reason text,
  confirmed_at  timestamptz,
  finished_at   timestamptz
);

create table if not exists bulk_job_rows (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references bulk_jobs(id) on delete cascade,
  row_number    int  not null,                          -- 1-based, source sheet
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- ── Parsed input. The spreadsheet is the sole source of these; nothing
  --    is ever read back off the Monday board.
  input_email      text,
  input_phone      text,
  input_phone_e164 text,
  input_address    text,
  input_postcode   text,
  input_bedrooms   int,
  input_guests     int,
  warnings         jsonb not null default '[]'::jsonb,

  -- ── Match resolved at preview time and approved by the admin before any
  --    money is spent. Pinning the id means the run writes to exactly the
  --    item that was shown, even if the board changes in between.
  monday_item_id     text,
  monday_item_name   text,
  match_method       text,
    -- email+postcode | email+phone | phone+postcode | email | phone
    -- | postcode | none
  -- Snapshot of the columns this row is about to overwrite. Monday has no
  -- undo, so this is what makes a bad run reversible by script.
  monday_prev_values jsonb,

  -- ── State machine
  --   pending ──claim──▶ claimed ──▶ running ──▶ succeeded
  --                                          └─▶ failed (attempts exhausted)
  --                                          └─▶ pending (retry)
  --   pending ──preview said skip──▶ skipped        (terminal, never claimed)
  --   claimed/running ──claim went stale──▶ reclaimable
  status       text not null default 'pending',
    -- pending | skipped | claimed | running | succeeded | failed | cancelled
  attempts     int  not null default 0,
  max_attempts int  not null default 2,
  claim_token  uuid,
  claimed_at   timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,

  -- ── Results
  error_code         text,
  error_message      text,
  report_id          uuid references analyser_reports(id) on delete set null,
  gross_revenue      numeric,
  net_revenue        numeric,
  long_let_monthly   numeric,
  recommendation     text,
  qualification      text,
  uplift_pct         numeric,
  data_quality_level text,
  comparables_found  int,
  monday_synced      boolean not null default false,
  pdf_uploaded       boolean not null default false
);

create unique index if not exists uq_bulk_job_rows_job_row
  on bulk_job_rows (job_id, row_number);
create index if not exists idx_bulk_job_rows_job   on bulk_job_rows (job_id);
create index if not exists idx_bulk_job_rows_claim on bulk_job_rows (status, claimed_at);

-- ─── Atomic row claiming ─────────────────────────────────────────
--
-- FOR UPDATE SKIP LOCKED is the whole mechanism: two workers hitting this in
-- the same millisecond receive disjoint rows without any application-level
-- locking. Cannot be expressed through the JS query builder, hence the RPC.
--
-- Ordering is by the JOB's created_at, then row_number — NOT by job_id, which
-- is a uuid and would interleave queued batches in random order. Larger
-- backlogs are run as sequential batches of ~100, so they must drain in the
-- order they were confirmed.
create or replace function claim_bulk_rows(
  p_limit         int,
  p_claim_token   uuid,
  p_max_inflight  int  default 6,
  p_stale_seconds int  default 900
) returns setof bulk_job_rows
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inflight int;
  v_take     int;
begin
  -- Global ceiling on rows running at once, across every worker. This is the
  -- Airbtics spend-rate throttle, not just a concurrency limit.
  select count(*) into v_inflight
    from bulk_job_rows r
   where r.status in ('claimed', 'running')
     and r.claimed_at > now() - make_interval(secs => p_stale_seconds);

  v_take := least(p_limit, greatest(p_max_inflight - v_inflight, 0));
  if v_take <= 0 then
    return;
  end if;

  return query
  with candidate as (
    select r.id
      from bulk_job_rows r
      join bulk_jobs j on j.id = r.job_id
     where j.status = 'running'
       and r.attempts < r.max_attempts
       and (
             r.status = 'pending'
             -- Reclaim anything abandoned by a killed invocation. The window is
             -- ~15x the worst-case row time, so it can't race a live worker.
             or (r.status in ('claimed', 'running')
                 and r.claimed_at < now() - make_interval(secs => p_stale_seconds))
           )
     order by j.created_at, r.row_number
     limit v_take
     for update of r skip locked
  )
  update bulk_job_rows r
     set status      = 'claimed',
         claim_token = p_claim_token,
         claimed_at  = now(),
         -- Incremented AT CLAIM, not on completion, so a row that hard-kills
         -- its worker (OOM, timeout) burns max_attempts and then stops rather
         -- than looping forever on someone else's credit.
         attempts    = r.attempts + 1,
         updated_at  = now()
    from candidate c
   where r.id = c.id
  returning r.*;
end;
$$;

-- The function is SECURITY DEFINER because it must bypass RLS to claim rows.
-- But Supabase exposes every public function at /rest/v1/rpc/<name>, and
-- EXECUTE defaults to PUBLIC — so without this it is callable by the `anon`
-- role using nothing but the publishable key, which would let anyone claim or
-- stall bulk job rows and defeat the RLS enabled below. (Supabase's own
-- database linter flags exactly this: lint 0028.) Only server code holding the
-- service-role key ever calls it.
revoke all on function public.claim_bulk_rows(int, uuid, int, int) from public;

-- anon / authenticated / service_role are Supabase-managed roles that do not
-- exist in a plain Postgres, so guard the grants — this migration also has to
-- apply against a vanilla instance (see scripts/verify-claim-rpc.sh).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.claim_bulk_rows(int, uuid, int, int) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.claim_bulk_rows(int, uuid, int, int) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_bulk_rows(int, uuid, int, int) to service_role';
  end if;
end $$;

-- ─── Row level security ──────────────────────────────────────────
--
-- Every one of these tables is only ever touched by the service-role key from
-- server code, which bypasses RLS — so enabling it with no policies changes
-- nothing today and denies everything to any other key.
--
-- analyser_reports is included deliberately. It holds lead emails, addresses
-- and the full raw_response. RLS is already enabled on it in production
-- (turned on via the dashboard rather than a migration), so this is a no-op
-- there — kept so the intent is explicit and a fresh environment matches.
alter table bulk_jobs        enable row level security;
alter table bulk_job_rows    enable row level security;
alter table analyser_reports enable row level security;
