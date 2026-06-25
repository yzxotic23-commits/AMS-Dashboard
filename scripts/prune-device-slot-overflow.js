#!/usr/bin/env node
/**
 * Remove accounts that exceed 2 WA slots per device (WS Normal + WS Business).
 *
 * Usage:
 *   node scripts/prune-device-slot-overflow.js           # dry-run (preview only)
 *   node scripts/prune-device-slot-overflow.js --apply   # delete overflow accounts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const apply = process.argv.includes('--apply');

const DEVICE_CHANNEL_SLOTS = ['WS Normal', 'WS Business'];
const LEGACY = { 'WS Slot 1': 'WS Normal', 'WS Slot 2': 'WS Business' };
const STATUS_RANK = {
  IN_USE: 6,
  NURTURING: 5,
  REGISTERING: 4,
  RECOVERING: 3,
  AVAILABLE: 2,
  BANNED: 1,
  LOGGED_OUT: 0,
};

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
  const prefix = '_ams_op:';
  const idx = text.indexOf(prefix);
  if (idx === -1) return {};
  try {
    return JSON.parse(text.slice(idx + prefix.length));
  } catch {
    return {};
  }
}

function normalizeChannel(channel) {
  const c = String(channel || '').trim();
  return LEGACY[c] || c;
}

function rankAccount(row) {
  return STATUS_RANK[row.status] ?? 0;
}

function pickBest(list) {
  return [...list].sort((a, b) => {
    const d = rankAccount(b) - rankAccount(a);
    if (d !== 0) return d;
    return new Date(b.updated_at) - new Date(a.updated_at);
  })[0];
}

function pickKeepers(accounts) {
  if (accounts.length <= 2) {
    return { kept: accounts, toDelete: [] };
  }

  const enriched = accounts.map((a) => ({
    ...a,
    slot: normalizeChannel(parseMeta(a.notes).channel) || '(none)',
  }));

  const bySlot = new Map();
  enriched.forEach((a) => {
    if (!bySlot.has(a.slot)) bySlot.set(a.slot, []);
    bySlot.get(a.slot).push(a);
  });

  const kept = [];
  for (const slot of DEVICE_CHANNEL_SLOTS) {
    const pool = bySlot.get(slot);
    if (pool?.length) kept.push(pickBest(pool));
  }

  if (kept.length < 2) {
    const keptIds = new Set(kept.map((a) => a.id));
    const remaining = enriched
      .filter((a) => !keptIds.has(a.id))
      .sort((a, b) => {
        const d = rankAccount(b) - rankAccount(a);
        if (d !== 0) return d;
        return new Date(b.updated_at) - new Date(a.updated_at);
      });

    for (const a of remaining) {
      if (kept.length >= 2) break;
      const slotTaken = kept.some((k) => k.slot === a.slot && a.slot !== '(none)');
      if (slotTaken) continue;
      kept.push(a);
    }
  }

  const finalKept = kept.slice(0, 2);
  const keepIds = new Set(finalKept.map((a) => a.id));
  const toDelete = accounts.filter((a) => !keepIds.has(a.id));
  return { kept: finalKept, toDelete };
}

loadEnv(envPath);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function clearBindings(accountIds) {
  if (!accountIds.length) return;
  await client.query(
    `UPDATE devices SET current_account_id = NULL, current_ip_id = NULL
     WHERE current_account_id = ANY($1::uuid[])`,
    [accountIds],
  );
  await client.query(
    'UPDATE sims SET current_account_id = NULL WHERE current_account_id = ANY($1::uuid[])',
    [accountIds],
  );
  await client.query(
    'UPDATE ips SET assigned_account_id = NULL, assigned_device_id = NULL WHERE assigned_account_id = ANY($1::uuid[])',
    [accountIds],
  );
  await client.query(
    'UPDATE tickets SET account_id = NULL WHERE account_id = ANY($1::uuid[])',
    [accountIds],
  );
}

try {
  await client.connect();

  const { rows } = await client.query(`
    SELECT a.id, a.account_name, a.status, a.device_id, a.notes, a.updated_at,
           d.device_name
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

  const plan = [];
  for (const [deviceId, accounts] of byDevice) {
    if (accounts.length <= 2) continue;
    const { kept, toDelete } = pickKeepers(accounts);
    plan.push({
      deviceId,
      deviceName: accounts[0].device_name,
      kept,
      toDelete,
    });
  }

  if (!plan.length) {
    console.log('✓ No devices exceed 2 accounts. Nothing to prune.');
    process.exit(0);
  }

  const allDelete = plan.flatMap((p) => p.toDelete);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} — ${plan.length} device(s) over slot limit, ${allDelete.length} account(s) to delete:\n`);

  for (const entry of plan) {
    console.log(`Device ${entry.deviceName} (${entry.kept.length + entry.toDelete.length} → keep ${entry.kept.length})`);
    entry.kept.forEach((a) => {
      const slot = normalizeChannel(parseMeta(a.notes).channel) || '(none)';
      console.log(`  KEEP  ${a.account_name} [${a.status}] · ${slot}`);
    });
    entry.toDelete.forEach((a) => {
      const slot = normalizeChannel(parseMeta(a.notes).channel) || '(none)';
      console.log(`  DELETE ${a.account_name} [${a.status}] · ${slot}`);
    });
    console.log('');
  }

  if (!apply) {
    console.log('Re-run with --apply to delete the accounts listed above.');
    process.exit(0);
  }

  await client.query('BEGIN');
  const deleteIds = allDelete.map((a) => a.id);
  await clearBindings(deleteIds);
  const del = await client.query(
    'DELETE FROM accounts WHERE id = ANY($1::uuid[]) RETURNING id, account_name',
    [deleteIds],
  );
  await client.query('COMMIT');

  console.log(`✓ Deleted ${del.rowCount} overflow account(s).`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('✗ Prune failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
