#!/bin/sh
set -eu

echo "PostgreSQL: $(psql -U postgres -d postgres -Atqc 'SHOW server_version')"
psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/followup.sql

pg_dump -U postgres -Fc -f /tmp/wacrm-followup.dump wacrm_followup
createdb -U postgres wacrm_followup_restored
pg_restore -U postgres -d wacrm_followup_restored /tmp/wacrm-followup.dump
psql -U postgres -d wacrm_followup_restored -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'account_records'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'restored RLS enable/force flags missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_records'
      AND policyname = 'account_records_scope'
      AND qual IS NOT NULL AND with_check IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'restored account RLS policy or write check missing';
  END IF;
  IF NOT has_table_privilege('wacrm_runtime', 'public.account_records', 'SELECT') THEN
    RAISE EXCEPTION 'restored runtime SELECT grant missing';
  END IF;
  IF has_schema_privilege('wacrm_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'restored runtime unexpectedly has CREATE on public';
  END IF;
END $$;
SELECT current_setting('server_version') AS restored_postgres_version,
       has_schema_privilege('wacrm_runtime', 'public', 'CREATE') AS runtime_public_create,
       has_table_privilege('wacrm_runtime', 'public.account_records', 'SELECT') AS runtime_select,
       (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='account_records') AS policy_count,
       (SELECT count(*) FROM account_records) AS synthetic_rows;
SQL

PGAPPNAME=hdb002_lock_holder psql -U postgres -d wacrm_followup -v ON_ERROR_STOP=1 \
  -c 'SELECT pg_advisory_lock(916017); SELECT pg_sleep(5); SELECT pg_advisory_unlock(916017);' \
  >/tmp/hdb002-lock-holder.out 2>&1 &
holder_pid=$!
tries=0
locked=0
while [ "$tries" -lt 50 ]; do
  locked=$(psql -U postgres -d wacrm_followup -Atqc \
    "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='hdb002_lock_holder' AND l.locktype='advisory' AND l.granted")
  [ "$locked" = 1 ] && break
  tries=$((tries + 1))
  sleep 0.1
done
if [ "$locked" != 1 ]; then
  cat /tmp/hdb002-lock-holder.out
  wait "$holder_pid"
  echo "holder lock was not observed before contender check" >&2
  exit 1
fi
printf 'holder_lock_observed_before_contender=%s\n' "$locked"
contender=$(psql -U postgres -d wacrm_followup -Atqc 'SELECT pg_try_advisory_lock(916017)')
printf 'concurrent_contender_acquired=%s\n' "$contender"
[ "$contender" = f ]
wait "$holder_pid"
cat /tmp/hdb002-lock-holder.out
echo 'FOLLOWUP_STATUS=SUCCESS; actual migration-runner replay remains untested.'
