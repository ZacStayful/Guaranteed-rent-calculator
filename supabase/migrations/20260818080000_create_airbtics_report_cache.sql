-- Durable cache of Airbtics report IDs.
--
-- Creating an Airbtics report costs ~£0.50; READING an existing one is free.
-- airbtics.ts already caches the report id for 24h — but only in a module-level
-- Map, which dies with the serverless invocation. So the cache almost never
-- hits in practice, and every run buys a fresh report.
--
-- That is expensive at any scale, and on Vercel Hobby it is the difference
-- between a safe feature and an unsafe one: a bulk row killed at the 60s
-- function ceiling has ALREADY paid for its report, and on retry would buy a
-- second one. Persisting the id means the retry re-reads the report it already
-- paid for and finishes in seconds.
--
-- Keyed exactly as the in-memory cache is: compacted postcode + bedroom count.

create table if not exists airbtics_report_cache (
  cache_key  text primary key,          -- e.g. "NG15GY_2bed"
  report_id  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_airbtics_report_cache_expires
  on airbtics_report_cache (expires_at);

-- Touched only by server code holding the service-role key, which bypasses
-- RLS. Enabled with no policies so nothing else can read it.
alter table airbtics_report_cache enable row level security;
