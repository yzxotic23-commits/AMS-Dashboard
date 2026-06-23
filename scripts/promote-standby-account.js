#!/usr/bin/env node
/**
 * Move an account to AVAILABLE (standby pool) for testing Tickets.
 *
 * Usage:
 *   node scripts/promote-standby-account.js [account_name]
 *   node scripts/promote-standby-account.js YST
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const nameArg = process.argv[2] || 'YST';

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  });
}

loadEnv(envPath);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const { rows } = await client.query(
  `SELECT id, account_name, status FROM accounts
   WHERE account_name ILIKE $1
   ORDER BY updated_at DESC
   LIMIT 1`,
  [nameArg],
);

if (!rows.length) {
  console.error(`No account matching "${nameArg}"`);
  process.exit(1);
}

const row = rows[0];
if (row.status === 'AVAILABLE') {
  console.log(`${row.account_name} is already AVAILABLE (standby).`);
  await client.end();
  process.exit(0);
}

const allowedFrom = new Set(['NURTURING', 'IN_USE', 'LOGGED_OUT']);
if (!allowedFrom.has(row.status)) {
  console.error(`${row.account_name} is ${row.status} — cannot move to standby from this status.`);
  process.exit(1);
}

await client.query(
  `UPDATE accounts SET status = 'AVAILABLE', updated_at = NOW() WHERE id = $1`,
  [row.id],
);
await client.query(
  `INSERT INTO account_status_history (account_id, from_status, to_status, reason, changed_at)
   VALUES ($1, $2, 'AVAILABLE', $3, NOW())`,
  [row.id, row.status, 'Moved back to standby pool for delivery retest'],
);

console.log(`✓ ${row.account_name} → AVAILABLE (standby)`);
await client.end();
