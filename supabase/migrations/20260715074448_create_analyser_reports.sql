-- Persistent storage for completed analyser reports.
--
-- Every successful run of /api/analyse writes one row here (fire-and-forget;
-- a failed write never affects the estimate returned to the lead). This table
-- later feeds the "Market Explorer" feature in Stayful Intelligence via an
-- aggregation endpoint that is NOT part of this migration.
--
-- `raw_response jsonb` stores the full computed AnalysisResult as a safety net:
-- if we later realise we need a field we didn't explicitly break out into a
-- column, it's recoverable without needing to re-gather data. Do not drop it.
--
-- `source` distinguishes live analyser traffic ('analyser') from any future
-- batch imports (e.g. the Monday.com PDF backfill, which will use
-- 'monday_backfill').

create table if not exists analyser_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  address text,
  postcode text,
  postcode_area text,
  bedrooms int,
  adr numeric,
  occupancy numeric,
  annual_revenue numeric,
  purchase_price numeric,
  lead_email text,
  source text default 'analyser',
  raw_response jsonb
);

create index if not exists idx_analyser_reports_postcode_area on analyser_reports (postcode_area);
create index if not exists idx_analyser_reports_bedrooms on analyser_reports (bedrooms);
