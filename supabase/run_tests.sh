#!/usr/bin/env bash
# Applies all migrations to a fresh local Postgres (with PostGIS) and runs every SQL test.
# Env: PGHOST (default /tmp), PGPORT (54329), PGUSER (postgres)
set -euo pipefail
cd "$(dirname "$0")"
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54329} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
DB=attendo_test
$P -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
$P -d $DB -f tests/00_supabase_shim.sql
for f in migrations/*.sql; do echo "apply $f"; $P -d $DB -f "$f" 2>&1 | grep -v -E "^(NOTICE|psql:.*NOTICE)" || true; done
$P -d $DB -f tests/01_harness.sql
for f in tests/[1-9][0-9]_*.sql; do [ "$f" = tests/01_harness.sql ] && continue; echo "run $f"; $P -d $DB -f "$f"; done
$P -d $DB -At -F ' | ' -c "select case when passed then 'PASS' else 'FAIL' end, name, coalesce(detail,'') from t.results order by n"
$P -d $DB -At -c "select 'TOTAL ' || count(*) || '  PASSED ' || count(*) filter (where passed) || '  FAILED ' || count(*) filter (where not passed) from t.results"
FAILED=$($P -d $DB -At -c "select count(*) from t.results where not passed")
[ "$FAILED" = "0" ]
