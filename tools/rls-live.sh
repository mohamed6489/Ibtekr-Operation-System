#!/usr/bin/env bash
# Runs live-safe RLS test files against DATABASE_URL (the live project): each file is one transaction that rolls back
# and ends with NOTICE '<name>: ok'. Usage: DATABASE_URL=postgresql://… bash tools/rls-live.sh [rls_vendors rls_vendor_logins …]
# Default: the two tests the Supabase MCP tool holds for approval (their text-only `delete from` statements). The URL is
# never printed; a failing file prints the tail of psql's output (test values only, no live rows) and the script exits 1.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL (the live Session-pooler connection string) is required}"
files="${*:-rls_vendors rls_vendor_logins}"
status=0
for name in $files; do
  if ! [[ "$name" =~ ^[a-z0-9_]+$ ]]; then echo "rls-live: refused test name: $name"; exit 2; fi
  f="supabase/tests/${name}.sql"
  if [ ! -f "$f" ]; then echo "rls-live: no such test: $f"; exit 2; fi
  echo "rls-live: $name …"
  if out=$(PGOPTIONS='-c client_min_messages=notice' psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    if printf '%s\n' "$out" | grep -Eq "NOTICE:[[:space:]]+${name}: ok"; then
      echo "rls-live: $name ok"
    else
      printf '%s\n' "$out" | tail -20; echo "rls-live: $name finished without its ok notice"; status=1
    fi
  else
    printf '%s\n' "$out" | tail -30; echo "rls-live: $name FAILED"; status=1
  fi
done
exit $status
