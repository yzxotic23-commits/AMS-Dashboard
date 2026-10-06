#!/usr/bin/env bash
# Restore drill: restores an encrypted backup into an EMPTY scratch Postgres and checks
# every table's row count against the backup manifest. Exit code 0 = backup is restorable.
#   RESTORE_DATABASE_URL  scratch database — never the live AMS database
#   BACKUP_PASSPHRASE     same passphrase used by backup.sh
#   $1                    path to ams-backup-*.tar.gz.enc
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
FILE="${1:?usage: restore-drill.sh <backup.tar.gz.enc>}"

if [[ "$RESTORE_DATABASE_URL" == *supabase.co* || "$RESTORE_DATABASE_URL" == *pooler.supabase.com* ]] \
  && [[ "${ALLOW_SUPABASE_TARGET:-}" != "1" ]]; then
  echo "Refusing to restore into a Supabase database. Use a scratch Postgres (or set ALLOW_SUPABASE_TARGET=1 for a dedicated test project)." >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$FILE" -out "$WORK/bundle.tar.gz" -pass env:BACKUP_PASSPHRASE
tar -xzf "$WORK/bundle.tar.gz" -C "$WORK"

EXISTING="$(psql "$RESTORE_DATABASE_URL" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [[ "$EXISTING" != "0" ]]; then
  echo "Scratch database is not empty ($EXISTING public tables). Use a fresh database." >&2
  exit 2
fi

# Supabase objects the dump references but does not contain.
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
SQL

echo "Restoring…"
# Order matters: auth.users with its primary key (profiles reference it), then the public
# schema, then the auth.users triggers (the signup trigger calls a public function).
pg_restore -l "$WORK/auth_users.dump" > "$WORK/auth_all.list"
grep -v ' TRIGGER ' "$WORK/auth_all.list" > "$WORK/auth_main.list" || true
grep ' TRIGGER ' "$WORK/auth_all.list" > "$WORK/auth_triggers.list" || true
restore() { pg_restore --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$@" 2>> "$WORK/restore.log"; }
set +e
restore -L "$WORK/auth_main.list" "$WORK/auth_users.dump"
restore "$WORK/public.dump"
[[ -s "$WORK/auth_triggers.list" ]] && restore -L "$WORK/auth_triggers.list" "$WORK/auth_users.dump"
set -e
RESTORE_ERRORS=0
if [[ -s "$WORK/restore.log" ]]; then
  echo "pg_restore output:"
  cat "$WORK/restore.log"
  RESTORE_ERRORS="$(grep -c 'error:' "$WORK/restore.log" || true)"
fi

echo "Verifying row counts…"
FAIL=0
while IFS=$'\t' read -r table expected; do
  actual="$(psql "$RESTORE_DATABASE_URL" -At -c "SELECT count(*) FROM $table" 2>/dev/null || echo "missing")"
  if [[ "$actual" != "$expected" ]]; then
    echo "MISMATCH  $table  expected=$expected  restored=$actual"
    FAIL=1
  fi
done < "$WORK/manifest.tsv"

TABLES="$(wc -l < "$WORK/manifest.tsv" | tr -d ' ')"
ROWS="$(awk -F'\t' '{s+=$2} END {print s}' "$WORK/manifest.tsv")"
if [[ "$RESTORE_ERRORS" != "0" ]]; then
  echo "pg_restore reported $RESTORE_ERRORS error(s)."
  FAIL=1
fi
if [[ "$FAIL" == "1" ]]; then
  echo "RESTORE DRILL FAILED — backup is not fully restorable." >&2
  exit 1
fi
echo "RESTORE DRILL PASSED — $TABLES tables, $ROWS rows restored and verified."
