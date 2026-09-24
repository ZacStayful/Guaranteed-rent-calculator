-- Admin credentials and password-reset tokens.
--
-- Passwords previously lived only in the ADMIN_PASSWORD_HASHES env var. That
-- works, but a running app cannot rewrite its own environment — so there was no
-- way to offer "forgot password" without an operator editing Vercel and
-- redeploying. Moving the hash into the database is what makes self-service
-- reset possible.
--
-- Migration is seamless: the app falls back to the env var whenever an email
-- has no row here, and writes a row the first time a password is set or reset.
-- So nothing breaks before or during the switch, and ADMIN_PASSWORD_HASHES can
-- be removed once every admin has reset once.

create table if not exists admin_users (
  email         text primary key,        -- always lowercased by the app
  password_hash text not null,
  password_salt text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One-time password-reset tokens.
--
-- The token itself is NEVER stored — only its SHA-256. A leaked database backup
-- therefore yields no usable reset links. Rows are single-use (used_at) and
-- short-lived (expires_at).
create table if not exists admin_password_resets (
  token_hash text primary key,
  email      text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  requested_ip text
);

create index if not exists idx_admin_password_resets_email
  on admin_password_resets (email);
create index if not exists idx_admin_password_resets_expires
  on admin_password_resets (expires_at);

-- Touched only by server code holding the service-role key, which bypasses RLS.
-- Enabled with no policies so no other key can read password hashes or tokens.
alter table admin_users            enable row level security;
alter table admin_password_resets  enable row level security;

-- RLS with no policies already denies these tables to anon, but Supabase grants
-- SELECT on public-schema tables to anon/authenticated by default, so the only
-- thing standing between the anon key and a table of password hashes would be
-- RLS staying switched on. Revoking the grant as well means it takes two
-- mistakes rather than one. Guarded because these roles exist in Supabase but
-- not in a vanilla Postgres, where this migration is also run for testing.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.admin_users, public.admin_password_resets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.admin_users, public.admin_password_resets from authenticated';
  end if;
end $$;
