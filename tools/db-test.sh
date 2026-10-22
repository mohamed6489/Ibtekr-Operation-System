#!/usr/bin/env bash
# Rebuild a throwaway database, apply supabase/migrations in order, run supabase/tests.
# Usage: DATABASE_URL=postgresql://... bash tools/db-test.sh [--stub]
#   --stub  first applies supabase/tests/_local_auth_stub.sql (plain local Postgres only).
set -euo pipefail

cd "$(dirname "$0")/.."

DATABASE_URL="${DATABASE_URL:-postgresql://postgres@127.0.0.1:54329/postgres}"
TEST_DB=ibtekr_test

STUB=0
for arg in "$@"; do
  case "$arg" in
    --stub) STUB=1 ;;
    *) echo "db-test: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Same server and credentials, database swapped for $TEST_DB (keeps any ?query).
base="${DATABASE_URL%%\?*}"
query="${DATABASE_URL#"$base"}"
TEST_URL="${base%/*}/${TEST_DB}${query}"

echo "db-test: recreating database ${TEST_DB}"
PGOPTIONS='-c client_min_messages=warning' psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists ${TEST_DB}" -c "create database ${TEST_DB}"

if [ "$STUB" = 1 ]; then
  echo "db-test: WARNING applying supabase/tests/_local_auth_stub.sql (local Postgres only, never on Supabase)"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/_local_auth_stub.sql
fi

shopt -s nullglob
for f in $(printf '%s\n' supabase/migrations/*.sql | sort); do
  echo "db-test: migrate ${f}"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

for f in $(printf '%s\n' supabase/tests/*.sql | sort); do
  case "$(basename "$f")" in _*) continue ;; esac
  echo "db-test: test ${f}"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "db-test: all passed"
