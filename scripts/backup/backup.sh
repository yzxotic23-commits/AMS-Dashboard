#!/usr/bin/env bash
# Encrypted AMS database backup: public schema (the ledger) + auth.users (logins).
#   DATABASE_URL       source database (use the Supabase session pooler URL from CI)
#   BACKUP_PASSPHRASE  encryption passphrase (keep it outside the repo)
#   OUT_DIR            output folder (default: ./backup-out)
# Produces ams-backup-<UTC timestamp>.tar.gz.enc containing public.dump, auth_users.dump
# and manifest.tsv
# (row count per table, used by restore-drill.sh to prove the restore is complete).
# Needs pg_dump / pg_restore at least as new as the server.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
OUT_DIR="${OUT_DIR:-./backup-out}"
STAMP="$(date -u +%Y%m%dT%H%MZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$OUT_DIR"

# Two dumps: pg_dump ignores --schema whenever --table is given. auth.users is dumped
# second so every profile in the public dump already has its login row.
echo "Dumping public schema…"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --schema=public --file="$WORK/public.dump"
echo "Dumping auth.users…"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --table=auth.users --file="$WORK/auth_users.dump"

echo "Counting rows in the dumps…"
# Counted from the dumps' own COPY blocks so the manifest matches the snapshot exactly
# (live counts drift while staff keep working).
for dump in public.dump auth_users.dump; do
  pg_restore --data-only --file=- "$WORK/$dump"
done | awk '
  /^COPY / { table = $2; rows = 0; inside = 1; next }
  inside && /^\\\.$/ { print table "\t" rows; inside = 0; next }
  inside { rows++ }
' | sort > "$WORK/manifest.tsv"

for required in auth.users public.profiles public.accounts; do
  if ! grep -q "^$required"$'\t' "$WORK/manifest.tsv"; then
    echo "Backup is missing $required — aborting." >&2
    exit 1
  fi
done

tar -czf "$WORK/bundle.tar.gz" -C "$WORK" public.dump auth_users.dump manifest.tsv
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$WORK/bundle.tar.gz" \
  -out "$OUT_DIR/ams-backup-$STAMP.tar.gz.enc" \
  -pass env:BACKUP_PASSPHRASE

echo "Backup written: $OUT_DIR/ams-backup-$STAMP.tar.gz.enc"
echo "Tables: $(wc -l < "$WORK/manifest.tsv"), rows: $(awk -F'\t' '{s+=$2} END {print s}' "$WORK/manifest.tsv")"
