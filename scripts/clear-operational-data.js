#!/usr/bin/env node
/**
 * Wipe AMS operational data from Supabase (keeps auth users + profiles).
 *
 * Usage:
 *   npm run clear:data              # wipe all operational rows
 *   npm run clear:data -- --bootstrap   # wipe + minimal devices/IPs for Register flow
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
const bootstrap = process.argv.includes('--bootstrap');

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

async function wipe() {
  await client.query(`
    TRUNCATE
      ip_gate_reviews, tickets,
      account_device_history, account_sim_history, account_ip_history, account_status_history,
      session_monitoring, ip_audits, daily_metrics,
      accounts, ips, devices, sims,
      audit_logs
    RESTART IDENTITY CASCADE
  `);
}

async function insertBootstrap() {
  const ips = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

  for (const d of BOOTSTRAP_DEVICES) {
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
  }

  await client.query(`
    INSERT INTO ips (id, proxy_provider, proxy_type, ip_address, port, username, password, country, status, risk_count) VALUES
    ($1, 'IPRoyal', 'SOCKS5', '103.21.44.25', '8080', 'user_my01', 'pass_my01', 'MY', 'ACTIVE', 0),
    ($2, 'IPRoyal', 'SOCKS5', '103.21.44.26', '8080', 'user_my02', 'pass_my02', 'MY', 'ACTIVE', 0),
    ($3, '922', 'SOCKS5', '175.100.8.70', '8080', 'user_pp01', 'pass_pp01', 'KH', 'ACTIVE', 0),
    ($4, '922', 'SOCKS5', '175.100.8.71', '8080', 'user_pp02', 'pass_pp02', 'KH', 'ACTIVE', 0)
  `, ips);

  const myCount = BOOTSTRAP_DEVICES.filter((d) => d.device_name.startsWith('MYR')).length;
  const ppCount = BOOTSTRAP_DEVICES.length - myCount;
  console.log(`  bootstrap: ${BOOTSTRAP_DEVICES.length} devices (${myCount} MY + ${ppCount} PP), 4 free IPs`);
}

try {
  await client.connect();

  const before = await client.query(`
    SELECT
      (SELECT count(*) FROM profiles) AS profiles,
      (SELECT count(*) FROM accounts) AS accounts,
      (SELECT count(*) FROM sims) AS sims,
      (SELECT count(*) FROM tickets) AS tickets
  `);
  const b = before.rows[0];
  console.log('Before wipe:');
  console.log(`  profiles: ${b.profiles} (kept)`);
  console.log(`  accounts: ${b.accounts}`);
  console.log(`  sims:     ${b.sims}`);
  console.log(`  tickets:  ${b.tickets}`);

  console.log('\nWiping operational data…');
  await wipe();

  if (bootstrap) {
    console.log('Inserting minimal bootstrap resources…');
    await insertBootstrap();
  }

  const after = await client.query(`
    SELECT
      (SELECT count(*) FROM profiles) AS profiles,
      (SELECT count(*) FROM devices) AS devices,
      (SELECT count(*) FROM ips) AS ips,
      (SELECT count(*) FROM sims) AS sims,
      (SELECT count(*) FROM accounts) AS accounts,
      (SELECT count(*) FROM tickets) AS tickets,
      (SELECT count(*) FROM audit_logs) AS audit_logs
  `);
  const a = after.rows[0];
  console.log('\n✓ Done. After wipe:');
  console.log(`  profiles: ${a.profiles} (unchanged)`);
  console.log(`  devices:  ${a.devices}`);
  console.log(`  ips:      ${a.ips}`);
  console.log(`  sims:     ${a.sims}`);
  console.log(`  accounts: ${a.accounts}`);
  console.log(`  tickets:  ${a.tickets}`);
  console.log(`  audit:    ${a.audit_logs}`);

  if (!bootstrap) {
    console.log('\nTip: run with --bootstrap to add wireframe devices + 4 IPs for Register flow.');
    console.log('     Or: npm run seed:devices (add devices without wiping data)');
  } else {
    console.log('\nNext: Register → Add prepared number → Fill Result → Activation → Nurturing');
  }
} catch (e) {
  console.error('✗ Clear failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
