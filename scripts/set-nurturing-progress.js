#!/usr/bin/env node
/**
 * Set nurturing day for testing Nurturing page buttons.
 *
 * Usage:
 *   node scripts/set-nurturing-progress.js GERI --day 3
 *   node scripts/set-nurturing-progress.js GERI --day 7 --phase auto
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const META_PREFIX = '_ams_op:';
const MS_DAY = 86_400_000;

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

function parseMeta(notes) {
  const text = notes || '';
  const idx = text.indexOf(META_PREFIX);
  if (idx === -1) return { human: text.trim(), meta: {} };
  return {
    human: text.slice(0, idx).trim(),
    meta: JSON.parse(text.slice(idx + META_PREFIX.length)),
  };
}

function serializeNotes(human, meta) {
  const payload = `${META_PREFIX}${JSON.stringify(meta)}`;
  return human ? `${human}\n${payload}` : payload;
}

function parseArgs(argv) {
  const name = argv[2];
  let day = 3;
  let phase = 'manual';
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--day' && argv[i + 1]) {
      day = parseInt(argv[i + 1], 10);
      i += 1;
    } else if (argv[i] === '--phase' && argv[i + 1]) {
      phase = argv[i + 1];
      i += 1;
    }
  }
  return { name, day, phase };
}

loadEnv(envPath);

const { name, day, phase } = parseArgs(process.argv);
if (!name || Number.isNaN(day) || day < 1) {
  console.error('Usage: node scripts/set-nurturing-progress.js <account_name> --day <1-7> [--phase manual|auto]');
  process.exit(1);
}

const maxDay = phase === 'auto' ? 7 : 3;
const safeDay = Math.min(maxDay, Math.max(1, day));
const startedAt = new Date(Date.now() - (safeDay - 1) * MS_DAY).toISOString();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const { rows } = await client.query(
  `SELECT id, account_name, status, notes FROM accounts
   WHERE account_name ILIKE $1
   ORDER BY updated_at DESC
   LIMIT 1`,
  [name],
);

if (!rows.length) {
  console.error(`No account matching "${name}"`);
  process.exit(1);
}

const row = rows[0];
if (row.status !== 'NURTURING') {
  console.error(`${row.account_name} is ${row.status} — must be NURTURING`);
  process.exit(1);
}

const { human, meta } = parseMeta(row.notes);
const nextMeta = {
  ...meta,
  nurturing_phase: phase,
  nurturing_started_at: startedAt,
};
const notes = serializeNotes(human, nextMeta);

await client.query(
  `UPDATE accounts SET notes = $1, updated_at = NOW() WHERE id = $2`,
  [notes, row.id],
);

console.log(`✓ ${row.account_name} · phase=${phase} · display day=${safeDay}/${maxDay}`);
console.log(`  nurturing_started_at=${startedAt}`);
if (phase === 'manual' && safeDay >= 3) {
  console.log('  → Scan-in button should be enabled on Nurturing page');
}
if (phase === 'auto' && safeDay >= 7) {
  console.log('  → Graduate-to-standby button should be enabled');
}

await client.end();
