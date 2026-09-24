#!/usr/bin/env bash
# Verify the bulk-job claim RPC against a throwaway Postgres.
#
# The claim function is the one piece of this feature that cannot be checked by
# reading it: FOR UPDATE SKIP LOCKED only proves itself under real concurrency.
# A row claimed twice costs another ~£0.50 of Airbtics credit and uploads a
# duplicate PDF to a lead's Monday item, so this is worth running whenever the
# function or its indexes change.
#
#   ./scripts/verify-claim-rpc.sh
#
# Requires the postgresql server binaries (initdb, pg_ctl) and psql. Creates a
# cluster under /var/tmp, applies every migration in supabase/migrations, runs
# the checks, then tears the cluster down.

set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PG_DIR="${PG_DIR:-/var/tmp/pgtest-claim}"
PG_PORT="${PG_PORT:-5434}"
MIGRATIONS="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"

JOB_OLD='ffffffff-ffff-ffff-ffff-ffffffffffff'
JOB_NEW='00000000-0000-0000-0000-000000000001'

cleanup() {
  su postgres -c "$PG_BIN/pg_ctl -D $PG_DIR/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PG_DIR"
}
trap cleanup EXIT

fail=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    printf '  ok   %-46s %s\n' "$1" "$2"
  else
    printf '  FAIL %-46s got %s, want %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

q() { su postgres -c "psql -h $PG_DIR -p $PG_PORT -d stayful -t -A -c \"$1\"" 2>&1; }
exec_sql() { su postgres -c "psql -h $PG_DIR -p $PG_PORT -d stayful -q -c \"$1\"" >/dev/null 2>&1; }

# ── Bring up a throwaway cluster ─────────────────────────────────
id -u postgres >/dev/null 2>&1 || useradd -m postgres
rm -rf "$PG_DIR"; mkdir -p "$PG_DIR"; chown postgres:postgres "$PG_DIR"; chmod 700 "$PG_DIR"
su postgres -c "$PG_BIN/initdb -D $PG_DIR/data -A trust" >/dev/null 2>&1
su postgres -c "$PG_BIN/pg_ctl -D $PG_DIR/data -o '-p $PG_PORT -k $PG_DIR' -l $PG_DIR/server.log start" >/dev/null 2>&1
sleep 3
su postgres -c "psql -h $PG_DIR -p $PG_PORT -d postgres -q -c 'create database stayful;'" >/dev/null 2>&1

echo "Applying migrations..."
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  su postgres -c "psql -h $PG_DIR -p $PG_PORT -d stayful -v ON_ERROR_STOP=1 -q -f $f" >/dev/null
  echo "  applied $(basename "$f")"
done

seed() { # seed <row_count>
  exec_sql "delete from bulk_job_rows; delete from bulk_jobs;"
  exec_sql "insert into bulk_jobs (id,status,created_by) values ('$JOB_OLD','running','test');"
  exec_sql "insert into bulk_job_rows (job_id,row_number) select '$JOB_OLD', g from generate_series(1,$1) g;"
}

echo
echo "Checks:"

# 1. Concurrent claims must be disjoint — the core guarantee.
seed 40
for i in $(seq 1 8); do
  su postgres -c "psql -h $PG_DIR -p $PG_PORT -d stayful -t -A -c \
    \"select id from claim_bulk_rows(10, gen_random_uuid(), 40, 900);\"" \
    > "$PG_DIR/claim_$i.txt" 2>&1 &
done
wait
cat "$PG_DIR"/claim_*.txt | grep -v '^$' | sort > "$PG_DIR/all.txt"
total=$(wc -l < "$PG_DIR/all.txt"); uniq=$(sort -u "$PG_DIR/all.txt" | wc -l)
check "8 concurrent workers, no double-claim" "$total" "$uniq"
check "no row over-attempted"                 "$(q "select count(*) from bulk_job_rows where attempts > 1;")" "0"

# 2. max_inflight is the Airbtics spend-rate throttle.
seed 40
check "max_inflight caps the first claim"     "$(q "select count(*) from claim_bulk_rows(10, gen_random_uuid(), 6, 900);")" "6"
check "max_inflight blocks while rows inflight" "$(q "select count(*) from claim_bulk_rows(10, gen_random_uuid(), 6, 900);")" "0"

# 3. A killed worker's rows come back.
exec_sql "update bulk_job_rows set claimed_at = now() - interval '20 minutes' where status='claimed';"
check "stale claims are reclaimed"            "$(q "select count(*) from claim_bulk_rows(10, gen_random_uuid(), 6, 900);")" "6"

# 4. ...but not forever.
seed 3
exec_sql "update bulk_job_rows set status='claimed', attempts=2, max_attempts=2, claimed_at=now() - interval '20 minutes';"
check "exhausted attempts are not re-claimed" "$(q "select count(*) from claim_bulk_rows(10, gen_random_uuid(), 40, 900);")" "0"

# 5. Terminal rows and cancelled jobs stay out.
seed 5
exec_sql "update bulk_job_rows set status='skipped';"
check "skipped rows are never claimed"        "$(q "select count(*) from claim_bulk_rows(10, gen_random_uuid(), 40, 900);")" "0"
seed 5
exec_sql "update bulk_jobs set status='cancelled';"
check "cancelled jobs stop being claimed"     "$(q "select count(*) from claim_bulk_rows(10, gen_random_uuid(), 40, 900);")" "0"

# 6. Queued batches drain oldest-first. JOB_OLD's uuid sorts LAST, so ordering
#    by job_id (the obvious mistake) would drain the wrong batch.
exec_sql "delete from bulk_job_rows; delete from bulk_jobs;"
exec_sql "insert into bulk_jobs (id,status,created_at,created_by) values
          ('$JOB_OLD','running', now() - interval '10 min','test'),
          ('$JOB_NEW','running', now(),'test');"
exec_sql "insert into bulk_job_rows (job_id,row_number) select '$JOB_OLD', g from generate_series(1,3) g;"
exec_sql "insert into bulk_job_rows (job_id,row_number) select '$JOB_NEW', g from generate_series(1,3) g;"
check "oldest batch drains first" \
  "$(q "select distinct job_id from claim_bulk_rows(3, gen_random_uuid(), 40, 900);")" "$JOB_OLD"

# 7. RLS on every table holding lead data.
for t in analyser_reports bulk_jobs bulk_job_rows; do
  check "RLS enabled on $t" \
    "$(q "select relrowsecurity from pg_class where relname='$t' and relkind='r';")" "t"
done

echo
if [ "$fail" -eq 0 ]; then echo "All checks passed."; else echo "FAILURES — see above."; fi
exit "$fail"
