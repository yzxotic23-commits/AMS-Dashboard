#!/usr/bin/env node
/**
 * Renumber device codes per site starting at 003 (MYR-SB-003, PP-SB-003, …).
 * Preserves device UUIDs — accounts keep their device_id bindings.
 *
 * Usage:
 *   npm run renumber:devices           # dry-run
 *   npm run renumber:devices -- --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import {
  DEVICE_UNIT_START,
  parseDeviceCode,
  formatDeviceCode,
  deviceNotesForUnit,
  siteDevicePrefix,
} from '../apps/api/src/lib/deviceCapacity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');

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

loadEnv(path.join(root, '.env'));

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

function siteKeyForPrefix(prefix) {
  return prefix === 'PP' ? 'pp' : 'my';
}

async function loadSiteDevices(client, siteKey) {
  const prefix = siteDevicePrefix(siteKey);
  const { rows } = await client.query(
    `SELECT id, device_name, serial_number
     FROM devices
     WHERE device_name ILIKE $1
     ORDER BY device_name`,
    [`${prefix}-%`],
  );
  return rows
    .map((row) => {
      const parsed = parseDeviceCode(row.device_name);
      if (!parsed || parsed.sitePrefix !== prefix) return null;
      return { ...row, unit: parsed.unit, brand: parsed.brand };
    })
    .filter(Boolean)
    .sort((a, b) => a.unit - b.unit || a.device_name.localeCompare(b.device_name));
}

function buildRenumberPlan(siteKey, rows) {
  const serialTag = siteKey === 'pp' ? 'PP' : 'MY';
  let unit = DEVICE_UNIT_START;
  return rows.map((row) => {
    const next = {
      id: row.id,
      from: row.device_name,
      to: formatDeviceCode(siteKey, unit, row.brand || 'SB'),
      serial: `SN-${serialTag}-${String(unit).padStart(3, '0')}`,
      notes: deviceNotesForUnit(siteKey, unit),
    };
    unit += 1;
    return next;
  }).filter((row) => row.from !== row.to);
}

async function applyPlan(client, plan) {
  for (const row of plan) {
    await client.query(
      `UPDATE devices SET device_name = $1, serial_number = NULL WHERE id = $2`,
      [`_REN-${row.id}`, row.id],
    );
  }
  for (const row of plan) {
    await client.query(
      `UPDATE devices
       SET device_name = $1, serial_number = $2, notes = $3, updated_at = NOW()
       WHERE id = $4`,
      [row.to, row.serial, row.notes, row.id],
    );
  }
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const allPlans = [];

  for (const siteKey of ['my', 'pp']) {
    const rows = await loadSiteDevices(client, siteKey);
    if (!rows.length) {
      console.log(`\n${siteKey.toUpperCase()}: no devices`);
      continue;
    }
    const plan = buildRenumberPlan(siteKey, rows);
    allPlans.push(...plan);
    console.log(`\n${siteKey.toUpperCase()} (${rows.length} devices):`);
    if (!plan.length) {
      console.log('  already numbered from 003');
      continue;
    }
    for (const row of plan) {
      console.log(`  ${row.from} → ${row.to}`);
    }
  }

  if (!allPlans.length) {
    console.log('\n✓ Nothing to renumber.');
    process.exit(0);
  }

  if (!apply) {
    console.log(`\nDry-run only. Re-run with --apply to update ${allPlans.length} device(s).`);
    process.exit(0);
  }

  await client.query('BEGIN');
  await applyPlan(client, allPlans);
  await client.query('COMMIT');
  console.log(`\n✓ Renumbered ${allPlans.length} device(s). Refresh Resource Ledger.`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('✗ renumber failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
