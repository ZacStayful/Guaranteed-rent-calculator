-- Align analyser_reports with the schema the live table was migrated to
-- out-of-band (after the initial create migration). Brings a from-scratch
-- database up to the current production shape so `supabase db push` on a
-- fresh project reproduces prod exactly.
--
-- Changes:
--   • annual_revenue -> gross_revenue (rename)
--   • + net_revenue, property_value_low/high  (headline figures from the
--     derived report — mirrors what the PDF shows the lead)
--   • + comp_* aggregate columns (comparable-set summary)
--   • + filename, extraction_status, extraction_error (used by the future
--     Monday PDF-backfill pipeline; live analyser writes set status 'ok')
--
-- Written idempotently so it is safe to re-run against a DB that already
-- has some or all of these changes.

do $$
begin
  if exists (
        select 1 from information_schema.columns
        where table_name = 'analyser_reports' and column_name = 'annual_revenue'
      )
     and not exists (
        select 1 from information_schema.columns
        where table_name = 'analyser_reports' and column_name = 'gross_revenue'
      )
  then
    alter table analyser_reports rename column annual_revenue to gross_revenue;
  end if;
end $$;

alter table analyser_reports
  add column if not exists gross_revenue           numeric,
  add column if not exists net_revenue             numeric,
  add column if not exists property_value_low      numeric,
  add column if not exists property_value_high     numeric,
  add column if not exists comp_count              int,
  add column if not exists comp_radius_km          numeric,
  add column if not exists comp_avg_adr            numeric,
  add column if not exists comp_avg_occupancy      numeric,
  add column if not exists comp_avg_annual_revenue numeric,
  add column if not exists filename                text,
  add column if not exists extraction_status       text,
  add column if not exists extraction_error        text;
