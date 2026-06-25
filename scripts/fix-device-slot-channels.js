#!/usr/bin/env node
/**
 * Backfill missing WA channel (_ams_op.channel) for accounts on a device.
 * Assigns WS Normal / WS Business to the first free slot per device.
 *
 * Usage:
 *   npm run fix:device-channels
 *   npm run fix:device-channels:apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');

const META_PREFIX = '_ams_op:';
const DEVICE_CHANNEL_SLOTS = ['WS Normal', 'WS Business'];
const LEGACY = { 'WS Slot 1': 'WS Normal', 'WS Slot 2': 'WS Business' };

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
  if (idx === -1) return {};
  try {
    return JSON.parse(text.slice(idx + META_PREFIX.length));
  } catch {
    return {};
  }
}

function normalizeChannel(channel) {
  const c = String(channel || '').trim();
  return LEGACY[c] || c;
}

function upsertOpMeta(notes, patch) {
  const text = notes || '';
  const idx = text.indexOf(META_PREFIX);
  const human = idx === -1 ? text.trim() : text.slice(0, idx).trim();
  const meta = idx === -1 ? {} : parseMeta(text);
  const next = { ...meta, ...patch };
  const payload = `${META_PREFIX}${JSON.stringify(next)}`;
  return human ? `${human}\n${payload}` : payload;
}

loadEnv(path.join(root, '.env'));

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const { rows } = await client.query(`
    SELECT a.id, a.account_name, a.notes, a.device_id, d.device_name
    FROM accounts a
    JOIN devices d ON d.id = a.device_id
    WHERE a.device_id IS NOT NULL
    ORDER BY d.device_name, a.account_name
  `);

  const byDevice = new Map();
  rows.forEach((row) => {
    if (!byDevice.has(row.device_id)) byDevice.set(row.device_id, []);
    byDevice.get(row.device_id).push(row);
  });

  const patches = [];
  for (const [, accounts] of byDevice) {
    const used = new Set();
    accounts.forEach((a) => {
      const ch = normalizeChannel(parseMeta(a.notes).channel);
      if (DEVICE_CHANNEL_SLOTS.includes(ch)) used.add(ch);
    });

    for (const account of accounts) {
      const ch = normalizeChannel(parseMeta(account.notes).channel);
      if (DEVICE_CHANNEL_SLOTS.includes(ch)) continue;
      const free = DEVICE_CHANNEL_SLOTS.find((s) => !used.has(s));
      if (!free) continue;
      used.add(free);
      patches.push({
        id: account.id,
        account_name: account.account_name,
        device_name: account.device_name,
        channel: free,
        notes: upsertOpMeta(account.notes, { channel: free }),
      });
    }
  }

  if (!patches.length) {
    console.log('✓ All device-bound accounts already have a WA channel.');
    process.exit(0);
  }

  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} — backfill channel for ${patches.length} account(s):\n`);
  patches.forEach((p) => {
    console.log(`  ${p.device_name} · ${p.account_name} → ${p.channel}`);
  });

  if (!apply) {
    console.log('\nRe-run with --apply to save.');
    process.exit(0);
  }

  await client.query('BEGIN');
  for (const p of patches) {
    await client.query('UPDATE accounts SET notes = $1 WHERE id = $2', [p.notes, p.id]);
  }
  await client.query('COMMIT');
  console.log(`\n✓ Updated ${patches.length} account(s).`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('✗ Fix failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
