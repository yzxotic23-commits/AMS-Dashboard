#!/usr/bin/env node
/**
 * Seed sample operational data into live Supabase (dev/staging).
 * Usage: npm run seed:sample
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { randomUUID } from 'crypto';

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

function opNotes(meta, human = '') {
  const payload = `_ams_op:${JSON.stringify(meta)}`;
  return human ? `${human}\n${payload}` : payload;
}

function prepNotes(meta) {
  return `_ams_prep:${JSON.stringify({ prepared: true, ...meta })}`;
}

loadEnv(envPath);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const ids = {
  dev1: randomUUID(),
  dev2: randomUUID(),
  dev3: randomUUID(),
  dev4: randomUUID(),
  ip1: randomUUID(),
  ip2: randomUUID(),
  ip3: randomUUID(),
  ip4: randomUUID(),
  ip5: randomUUID(),
  sim1: randomUUID(),
  sim2: randomUUID(),
  sim3: randomUUID(),
  sim4: randomUUID(),
  sim5: randomUUID(),
  sim6: randomUUID(),
  acct1: randomUUID(),
  acct2: randomUUID(),
  acct3: randomUUID(),
  acct4: randomUUID(),
  acct5: randomUUID(),
  acct6: randomUUID(),
};

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('Clearing existing operational data…');
  await client.query(`
    TRUNCATE
      ip_gate_reviews, tickets,
      account_device_history, account_sim_history, account_ip_history, account_status_history,
      session_monitoring, ip_audits, daily_metrics,
      accounts, ips, devices, sims,
      audit_logs
    RESTART IDENTITY CASCADE
  `);

  console.log('Inserting sample devices, IPs, SIMs, accounts…');

  await client.query(`
    INSERT INTO devices (id, device_name, brand, model, serial_number, status) VALUES
    ($1, 'MYR-SB-001', 'Samsung', 'A14', 'SN-MY-001', 'ACTIVE'),
    ($2, 'MYR-SB-002', 'Samsung', 'A14', 'SN-MY-002', 'ACTIVE'),
    ($3, 'PP-SB-011', 'Oppo', 'A58', 'SN-PP-011', 'ACTIVE'),
    ($4, 'MYR-SB-003', 'Xiaomi', 'Redmi 12', 'SN-MY-003', 'ACTIVE')
  `, [ids.dev1, ids.dev2, ids.dev3, ids.dev4]);

  await client.query(`
    INSERT INTO ips (id, proxy_provider, proxy_type, ip_address, port, username, password, country, status, risk_count) VALUES
    ($1, 'IPRoyal', 'SOCKS5', '103.21.44.25', '8080', 'user_my01', 'pass_my01', 'MY', 'ACTIVE', 1),
    ($2, 'IPRoyal', 'SOCKS5', '103.21.44.26', '8080', 'user_my02', 'pass_my02', 'MY', 'ACTIVE', 3),
    ($3, '922', 'SOCKS5', '175.100.8.70', '8080', 'user_pp01', 'pass_pp01', 'KH', 'ACTIVE', 0),
    ($4, '922', 'SOCKS5', '175.100.8.71', '8080', 'user_pp02', 'pass_pp02', 'KH', 'ACTIVE', 2),
    ($5, 'IPRoyal', 'SOCKS5', '103.21.44.27', '8080', 'user_my03', 'pass_my03', 'MY', 'ACTIVE', 0)
  `, [ids.ip1, ids.ip2, ids.ip3, ids.ip4, ids.ip5]);

  await client.query(`
    INSERT INTO sims (id, phone_number, carrier, status, notes) VALUES
    ($1, '+601122045570', 'Tunetalk', 'OK', $7),
    ($2, '+601122045571', 'Digi', 'OK', $8),
    ($3, '+855965530100', 'Smart', 'OK', $9),
    ($4, '+601122045572', 'Celcom', 'OK', NULL),
    ($5, '+601122045573', 'Outsource', 'OK', NULL),
    ($6, '+855965530101', 'Outsource', 'OK', NULL)
  `, [
    ids.sim1, ids.sim2, ids.sim3, ids.sim4, ids.sim5, ids.sim6,
    prepNotes({ need: true, site_key: 'my', note: 'Supply refill MY' }),
    prepNotes({ need: true, site_key: 'my', note: 'Replacement batch' }),
    prepNotes({ need: true, site_key: 'pp', note: 'Standby pool PP' }),
  ]);

  await client.query(`
    INSERT INTO accounts (id, account_name, phone_number, status, device_id, sim_id, ip_id, wsaf_slot, notes) VALUES
    ($1, 'SBMY-ela1', '+601122045580', 'REGISTERING', $7, $8, $9, 0, $13),
    ($2, 'SBMY-ela2', '+601122045581', 'NURTURING',   $10, $11, $12, 1, $14),
    ($3, 'SBMY-Oliver', '+601122045582', 'AVAILABLE', $15, NULL, $16, NULL, $17),
    ($4, 'PP-Ben', '+855965530200', 'IN_USE',      $18, $19, $20, 2, $21),
    ($5, 'SBMY-Cindy', '+601122045583', 'RECOVERING', NULL, NULL, NULL, NULL, $22),
    ($6, 'PP-Joyce', '+855965530201', 'NURTURING', $18, NULL, $20, 3, $23)
  `, [
    ids.acct1, ids.acct2, ids.acct3, ids.acct4, ids.acct5, ids.acct6,
    ids.dev1, ids.sim4, ids.ip1,
    ids.dev2, ids.sim5, ids.ip2,
    opNotes({ site_key: 'my', channel: 'WS Normal', prepared_telco: 'Celcom' }, 'Awaiting activation'),
    opNotes({ site_key: 'my', channel: 'WS Normal', nurturing_phase: 'manual', nurturing_started_at: new Date().toISOString(), linked_override: true }, 'Manual nurture day 2'),
    ids.dev3, ids.ip5,
    opNotes({ site_key: 'my', channel: 'WS Business', linked_override: true }, 'Standby for delivery'),
    ids.dev4, ids.sim6, ids.ip3,
    opNotes({ site_key: 'pp', channel: 'WS Normal', linked_override: true }, 'Live in business use'),
    opNotes({ site_key: 'my', channel: 'WS Normal' }, 'SIM issue — recovery queue'),
    opNotes({ site_key: 'pp', channel: 'WS Business', nurturing_phase: 'auto', nurturing_started_at: new Date(Date.now() - 5 * 86400000).toISOString(), linked_override: true }, 'Engine monitored day 6'),
  ]);

  const linkRows = [
    [ids.acct1, ids.ip1, ids.dev1, ids.sim4],
    [ids.acct2, ids.ip2, ids.dev2, ids.sim5],
    [ids.acct3, ids.ip5, ids.dev3, null],
    [ids.acct4, ids.ip3, ids.dev4, ids.sim6],
    [ids.acct6, ids.ip3, ids.dev4, null],
  ];
  for (const [acctId, ipId, devId, simId] of linkRows) {
    await client.query('UPDATE devices SET current_account_id = $1, current_ip_id = $2 WHERE id = $3', [acctId, ipId, devId]);
    if (simId) {
      await client.query('UPDATE sims SET current_account_id = $1 WHERE id = $2', [acctId, simId]);
    }
    await client.query('UPDATE ips SET assigned_account_id = $1, assigned_device_id = $2 WHERE id = $3', [acctId, devId, ipId]);
  }

  await client.query(`
    INSERT INTO tickets (title, description, status, account_id) VALUES
    ($1, $2, 'OPEN', $3),
    ($4, $5, 'IN_PROGRESS', $6)
  `, [
    'Go-live request · SBMY-Oliver',
    `_ams_tkt:${JSON.stringify({
      site_key: 'my',
      link_code: '482910',
      delivery_stage: 'submitted',
      channel: 'WS Business',
      shot_proxy: { ip_address: '103.21.44.25', port: '8080', username: 'user_my01', password: 'pass_my01' },
    })}`,
    ids.acct3,
    'Go-live request · PP-Ben',
    `_ams_tkt:${JSON.stringify({
      site_key: 'pp',
      link_code: '193847',
      delivery_stage: 'posted',
      channel: 'WS Normal',
      shot_proxy: { ip_address: '175.100.8.70', port: '8080', username: 'user_pp01', password: 'pass_pp01' },
    })}`,
    ids.acct4,
  ]);

  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM devices) AS devices,
      (SELECT count(*) FROM ips) AS ips,
      (SELECT count(*) FROM sims) AS sims,
      (SELECT count(*) FROM accounts) AS accounts,
      (SELECT count(*) FROM tickets) AS tickets
  `);

  const c = counts.rows[0];
  console.log('✓ Sample data seeded:');
  console.log(`  devices:  ${c.devices}`);
  console.log(`  ips:      ${c.ips}`);
  console.log(`  sims:     ${c.sims} (3 prepared for Register queue)`);
  console.log(`  accounts: ${c.accounts}`);
  console.log(`  tickets:  ${c.tickets}`);
} catch (e) {
  console.error('✗ Seed failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
