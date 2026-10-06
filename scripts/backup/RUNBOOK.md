# AMS — Backup & Recovery Runbook

## What protects the data

| Layer | What | Retention | Who restores |
|---|---|---|---|
| Supabase Pro daily backup | Whole database (managed by Supabase) | 7 days | Supabase dashboard → Database → Backups |
| Nightly encrypted backup (this folder) | `public` schema + `auth.users`, AES-256 encrypted | 30 days (GitHub Actions artifacts) | This runbook, step B |
| Audit log | Every export, delete, lock/role change, setting change, circuit-breaker trip | Permanent (`audit_logs`) | Audit Log page |

The nightly job (`.github/workflows/db-backup.yml`, 02:00 WIB) runs a **restore drill** right after every
backup: it restores into an empty Postgres 17 and checks every table's row count. A red run (or a Slack
alert, if the webhook is set) means last night's backup is not trustworthy — investigate the same day.

## One-time setup

GitHub → repo → Settings → Secrets and variables → Actions → New repository secret:

- `BACKUP_DATABASE_URL` — Supabase → Connect → **Session pooler** URI (GitHub runners have no IPv6, so the
  direct `db.<ref>.supabase.co` host does not work). Include the password.
- `BACKUP_PASSPHRASE` — long random string (`openssl rand -hex 32`). Store it in the password manager too:
  **without it the backups cannot be decrypted.**
- `ALERT_SLACK_WEBHOOK_URL` — optional, same webhook as the API alerts; posts when backup/drill fails.

Then Actions → "AMS database backup" → Run workflow, and confirm both jobs are green.

## A. Something was deleted or changed by mistake (data still mostly fine)

1. Stop the damage: lock the account involved (Settings → User management → Lock). If an automation is
   looping, the circuit-breaker will already have paused it — do not press "Resume".
2. Find what changed: Audit Log page (sidebar; filter by user / action). `previous_value` holds the old row
   for deletes and updates — small fixes can be re-entered by hand from there.
3. For larger damage, pull just the affected table from last night's backup (step B, items 1–2), restore it
   into a local scratch Postgres with `restore-drill.sh`, and copy the needed rows back.

## B. Full recovery (database lost or corrupted)

First choice: Supabase dashboard → Database → Backups → restore the latest daily backup. Use the steps
below only if that is unavailable or older than the nightly artifact.

1. Download: GitHub → Actions → latest green "AMS database backup" run → artifact `ams-db-backup`.
2. Decrypt and unpack:
   ```bash
   export BACKUP_PASSPHRASE='…'
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
     -in ams-backup-*.tar.gz.enc -out bundle.tar.gz
   tar -xzf bundle.tar.gz   # public.dump, auth_users.dump, manifest.tsv
   ```
3. Create a new Supabase project (or empty the broken one) and take its **session pooler** URL as
   `TARGET_URL`. Postgres client tools 17 are needed (`brew install postgresql@17`).
4. Restore, in this order:
   ```bash
   # logins (the table already exists in a Supabase project, so data only)
   pg_restore --data-only --no-owner --dbname="$TARGET_URL" auth_users.dump
   # application schema + data
   pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" public.dump
   # signup trigger on auth.users
   pg_restore -l auth_users.dump | grep ' TRIGGER ' > triggers.list
   pg_restore --no-owner --use-list=triggers.list --dbname="$TARGET_URL" auth_users.dump
   # re-apply the access lockdown and refresh the API schema cache
   psql "$TARGET_URL" -f supabase/migrations/015_lock_direct_db_access.sql
   psql "$TARGET_URL" -c "NOTIFY pgrst, 'reload schema'"
   ```
5. Check counts against `manifest.tsv` (e.g. `SELECT count(*) FROM accounts;`).
6. If it is a new project: update `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DATABASE_URL` (and the `VITE_` copies) in Vercel, redeploy, update `BACKUP_DATABASE_URL` in GitHub.
7. Log in as admin, open Accounts / SIM Ledger / Audit log, and confirm the latest records are there.

## Emergency switches

- `IP_ALLOWLIST_BYPASS=1` (Vercel env, redeploy) — turns off the office-IP gate if staff are locked out.
- `BREAKER_LIMITS` — e.g. `account_ban:20,account_disconnect:30,delete:20` (per 10 minutes, all users).
- `EXPORT_ALLOWED_USERNAMES` — comma list of usernames allowed to export; empty = all admins.
