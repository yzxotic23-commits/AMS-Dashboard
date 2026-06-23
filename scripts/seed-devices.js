#!/usr/bin/env node
/**
 * Add wireframe device inventory without wiping other data.
 * Usage: npm run seed:devices
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { randomUUID } from 'crypto';
import { BOOTSTRAP_DEVICES, deviceNotes } from './bootstrap-devices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

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

try {
  await client.connect();
  const { rows: existing } = await client.query('SELECT device_name FROM devices');
  const have = new Set(existing.map((r) => r.device_name));
  let added = 0;

  for (const d of BOOTSTRAP_DEVICES) {
    if (have.has(d.device_name)) continue;
    await client.query(
      `INSERT INTO devices (id, device_name, brand, model, serial_number, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        d.device_name,
        'Samsung',
        'A14',
        d.serial_number,
        d.status || 'ACTIVE',
        deviceNotes(d.shelf),
      ],
    );
    added += 1;
    console.log(`  + ${d.device_name} · ${d.shelf}`);
  }

  const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM devices');
  console.log(`\n✓ Added ${added} device(s). Total devices: ${count}`);
  if (added === 0) console.log('  (all wireframe devices already present)');
} catch (e) {
  console.error('✗ seed:devices failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
