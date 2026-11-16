#!/usr/bin/env bash
# Rebuilds a throwaway local database and runs every transaction test.
set -e
cd "$(dirname "$0")/../.."
DB=tm_erp_test
dropdb --if-exists $DB >/dev/null 2>&1 || true
createdb $DB
for f in scripts/test/stub_supabase.sql supabase/01_schema.sql supabase/02_logic.sql supabase/03_seed.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f" 2>&1 | grep -v -e NOTICE -e wal_level -e 'HINT' || true
done
psql -q -v ON_ERROR_STOP=1 -d $DB -c "select load_seed();" >/dev/null
psql -v ON_ERROR_STOP=1 -d $DB -f scripts/test/transactions.sql 2>&1 | grep -E "ok - |FAIL|ERROR|ALL TESTS" | sed "s/^.*NOTICE:  //"
