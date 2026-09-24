-- Carry the landlord's asking rent through a bulk screening run.
--
-- The guaranteed-rent offer is priced against the rent the landlord wants, so
-- a bulk sheet can now carry a "Desired rent" column. It is optional: a blank
-- cell falls back to the estimated long-let rent, and the assessment marks the
-- figure as an estimate rather than presenting it as the landlord's answer.
--
-- numeric rather than int — sheets carry "1,200.50" often enough to matter, and
-- rounding to whole pounds is the model's job, not the column's.
--
-- Idempotent, so it is safe to re-run against a database that already has it.

alter table if exists bulk_job_rows
  add column if not exists input_desired_rent numeric;

comment on column bulk_job_rows.input_desired_rent is
  'Monthly rent the landlord is asking for, in GBP. Null when the sheet had no value, in which case the assessment estimates it and flags it as estimated.';
