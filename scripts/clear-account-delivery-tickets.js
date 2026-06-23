#!/usr/bin/env node
/**
 * Remove completed delivery tickets (and related IP gate reviews) for one account.
 *
 * Usage:
 *   node scripts/clear-account-delivery-tickets.js YST
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

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: accounts } = await client.query(
  `SELECT id, account_name FROM accounts WHERE account_name ILIKE $1 ORDER BY updated_at DESC LIMIT 1`,
  [nameArg],
);
if (!accounts.length) {
  console.error(`No account matching "${nameArg}"`);
  process.exit(1);
}

const account = accounts[0];
const { rows: tickets } = await client.query(
  `SELECT id, ticket_number, status FROM tickets
   WHERE account_id = $1 AND status IN ('RESOLVED', 'CLOSED')
   ORDER BY created_at DESC`,
  [account.id],
);

if (!tickets.length) {
  console.log(`No completed tickets for ${account.account_name}.`);
  await client.end();
  process.exit(0);
}

const ticketIds = tickets.map((t) => t.id);
console.log(`Removing ${tickets.length} completed ticket(s) for ${account.account_name}:`);
tickets.forEach((t) => console.log(`  - ${t.ticket_number} (${t.status})`));

const reviewDelete = await client.query(
  'DELETE FROM ip_gate_reviews WHERE account_id = $1',
  [account.id],
);
const ticketDelete = await client.query(
  `DELETE FROM tickets WHERE id = ANY($1::uuid[])`,
  [ticketIds],
);

console.log(`✓ Deleted ${ticketDelete.rowCount} ticket(s), ${reviewDelete.rowCount} IP gate review(s)`);
await client.end();
