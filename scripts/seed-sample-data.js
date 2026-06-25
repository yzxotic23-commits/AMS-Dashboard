#!/usr/bin/env node
/**
 * Seed moderate sample operational data for flow testing (dev/staging).
 * Keeps auth profiles — wipes accounts, devices, sims, ips, tickets only.
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

function recNotes(recoveryMeta, human = '') {
  const payload = `_ams_rec:${JSON.stringify(recoveryMeta)}`;
  return human ? `${human}\n${payload}` : payload;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

loadEnv(envPath);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const id = () => randomUUID();

const ids = {
  devMY1: id(), devMY2: id(), devMY3: id(), devPP1: id(),
  ipMY1: id(), ipMY2: id(), ipMY3: id(), ipPP1: id(), ipPP2: id(),
  simPrep1: id(), simPrep2: id(),
  sim1: id(), sim2: id(), sim3: id(), sim4: id(), sim5: id(), sim6: id(), sim7: id(),
  simAlignDemo: id(), simAlignDemo2: id(), simAlignDemo3: id(),
  acReg: id(), acMan1: id(), acMan3: id(), acAuto: id(), acAuto7: id(),
  acStandby: id(), acInUse: id(), acBanned: id(), acRecovering: id(),
  acAlignDemo: id(), acAlignDemo2: id(), acAlignDemo3: id(),
  igrStandby: id(), igrInUse: id(),
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

  console.log('Inserting moderate sample set…');

  await client.query(`
    INSERT INTO devices (id, device_name, brand, model, serial_number, status) VALUES
    ($1, 'MYR-SB-001', 'Samsung', 'A14', 'SN-MY-001', 'ACTIVE'),
    ($2, 'MYR-SB-002', 'Samsung', 'A14', 'SN-MY-002', 'ACTIVE'),
    ($3, 'MYR-SB-003', 'Xiaomi', 'Redmi 12', 'SN-MY-003', 'ACTIVE'),
    ($4, 'PP-SB-011', 'Oppo', 'A58', 'SN-PP-011', 'ACTIVE')
  `, [ids.devMY1, ids.devMY2, ids.devMY3, ids.devPP1]);

  await client.query(`
    INSERT INTO ips (id, proxy_provider, proxy_type, ip_address, port, username, password, country, status, risk_count) VALUES
    ($1, 'IPRoyal', 'SOCKS5', '103.21.44.25', '8080', 'user_my01', 'pass_my01', 'MY', 'ACTIVE', 1),
    ($2, 'IPRoyal', 'SOCKS5', '103.21.44.26', '8080', 'user_my02', 'pass_my02', 'MY', 'ACTIVE', 2),
    ($3, 'IPRoyal', 'SOCKS5', '103.21.44.27', '8080', 'user_my03', 'pass_my03', 'MY', 'ACTIVE', 0),
    ($4, '922', 'SOCKS5', '175.100.8.70', '8080', 'user_pp01', 'pass_pp01', 'KH', 'ACTIVE', 0),
    ($5, '922', 'SOCKS5', '175.100.8.71', '8080', 'user_pp02', 'pass_pp02', 'KH', 'ACTIVE', 1)
  `, [ids.ipMY1, ids.ipMY2, ids.ipMY3, ids.ipPP1, ids.ipPP2]);

  await client.query(`
    INSERT INTO sims (id, phone_number, carrier, status, notes) VALUES
    ($1, '+60199001101', 'Tunetalk', 'OK', $10),
    ($2, '+60199001102', 'Digi', 'OK', $11),
    ($3, '+601122045580', 'Celcom', 'OK', NULL),
    ($4, '+601122045581', 'Outsource', 'OK', NULL),
    ($5, '+601122045582', 'Tunetalk', 'OK', NULL),
    ($6, '+855965530200', 'Smart', 'OK', NULL),
    ($7, '+855965530201', 'Outsource', 'OK', NULL),
    ($8, '+601122045583', 'Celcom', 'OK', NULL),
    ($9, '+855965530202', 'Smart', 'OK', NULL),
    ($10, '+60199001299', 'Tunetalk', 'OK', $12),
    ($11, '+60199001302', 'Tunetalk', 'OK', $13),
    ($12, '+60199001304', 'Digi', 'OK', $14)
  `, [
    ids.simPrep1, ids.simPrep2,
    ids.sim1, ids.sim2, ids.sim3, ids.sim4, ids.sim5, ids.sim6, ids.sim7,
    ids.simAlignDemo, ids.simAlignDemo2, ids.simAlignDemo3,
    prepNotes({ need: true, site_key: 'my', note: 'Supply: registration pipeline below target' }),
    prepNotes({ need: false, site_key: 'my', note: 'Spare MY number' }),
    prepNotes({ site_key: 'my', note: 'Align demo 1 — SIM +60199001299' }),
    prepNotes({ site_key: 'my', note: 'Align demo 2 — SIM +60199001302' }),
    prepNotes({ site_key: 'my', note: 'Align demo 3 — SIM +60199001304' }),
  ]);

  await client.query(`
    INSERT INTO accounts (id, account_name, phone_number, status, device_id, sim_id, ip_id, wsaf_slot, notes) VALUES
    ($1::uuid,  'SBMY-new01',  '+601122045580', 'REGISTERING', $10::uuid, $11::uuid, $12::uuid, 0,  $24),
    ($2::uuid,  'SBMY-ela1',   '+601122045581', 'NURTURING',   $13::uuid, $14::uuid, $15::uuid, 1,  $25),
    ($3::uuid,  'SBMY-ela2',   '+601122045582', 'NURTURING',   $13::uuid, $14::uuid, $15::uuid, NULL, $26),
    ($4::uuid,  'SBMY-Oliver', '+601122045583', 'NURTURING',   $16::uuid, $17::uuid, $18::uuid, 2,  $27),
    ($5::uuid,  'SBMY-Pam',    '+601122045584', 'NURTURING',   $16::uuid, NULL::uuid, $18::uuid, 3,  $28),
    ($6::uuid,  'SBMY-mey',    '+601122045585', 'AVAILABLE',   $10::uuid, NULL::uuid, $19::uuid, NULL, $29),
    ($7::uuid,  'PP-Ben',      '+855965530200', 'IN_USE',      $20::uuid, $21::uuid, $22::uuid, 4,  $30),
    ($8::uuid,  'SBMY-Cindy',  '+601122045586', 'BANNED',      NULL::uuid, NULL::uuid, NULL::uuid, NULL, $31),
    ($9::uuid,  'PP-Joyce',    '+855965530201', 'RECOVERING',  $20::uuid, $23::uuid, $22::uuid, NULL, $32),
    ($10::uuid, 'SBMY-align-demo', '+60199001298', 'AVAILABLE', NULL::uuid, $24::uuid, NULL::uuid, NULL, $33),
    ($11::uuid, 'SBMY-align-demo-2', '+60199001301', 'AVAILABLE', NULL::uuid, $25::uuid, NULL::uuid, NULL, $34),
    ($12::uuid, 'SBMY-align-demo-3', '+60199001303', 'AVAILABLE', NULL::uuid, $26::uuid, NULL::uuid, NULL, $35)
  `, [
    ids.acReg, ids.acMan1, ids.acMan3, ids.acAuto, ids.acAuto7,
    ids.acStandby, ids.acInUse, ids.acBanned, ids.acRecovering,
    ids.acAlignDemo, ids.acAlignDemo2, ids.acAlignDemo3,
    ids.devMY1, ids.sim1, ids.ipMY1,
    ids.devMY2, ids.sim2, ids.ipMY2,
    ids.devMY3, ids.sim6, ids.ipMY3, ids.ipMY2,
    ids.devPP1, ids.sim4, ids.ipPP1, ids.sim5,
    ids.simAlignDemo, ids.simAlignDemo2, ids.simAlignDemo3,
    opNotes({ site_key: 'my', channel: 'WS Normal', owner: 'RM Executor 1', prepared_telco: 'Celcom' }, 'Awaiting activation'),
    opNotes({
      site_key: 'my', channel: 'WS Normal', owner: 'RM Executor 1',
      nurturing_phase: 'manual', nurturing_started_at: daysAgo(1), linked_override: true,
    }, 'Manual nurture day 2'),
    opNotes({
      site_key: 'my', channel: 'WS Business', owner: 'RM Executor 2',
      nurturing_phase: 'manual', nurturing_started_at: daysAgo(2), linked_override: true,
    }, 'Manual nurture — ready for scan-in'),
    opNotes({
      site_key: 'my', channel: 'WS Normal', owner: 'RM Executor 1',
      nurturing_phase: 'auto', nurturing_started_at: daysAgo(4), linked_override: true,
    }, 'System monitoring day 5'),
    opNotes({
      site_key: 'my', channel: 'WS Business', owner: 'RM Executor 2',
      nurturing_phase: 'auto', nurturing_started_at: daysAgo(6), linked_override: true,
    }, 'System monitoring day 7 — ready for standby'),
    opNotes({ site_key: 'my', channel: 'WS Business', owner: 'RM Executor 1', linked_override: true }, 'Standby pool'),
    opNotes({ site_key: 'pp', channel: 'WS Normal', owner: 'RM Executor 1', linked_override: true }, 'Live delivery'),
    recNotes({
      recovery_status: 'need',
      started_at: daysAgo(1),
      ban_stage: 'manual',
      ban_reason: 'SIM card issue',
      log: [{ st: 'need', time: daysAgo(1), by: 'System' }],
    }, 'Banned during manual nurture'),
    `${recNotes({
      recovery_status: 'doing',
      started_at: daysAgo(2),
      ban_stage: 'auto',
      ban_reason: 'Restrict during auto nurture',
      log: [
        { st: 'need', time: daysAgo(2), by: 'System' },
        { st: 'doing', time: daysAgo(1), by: 'RM Executor 1' },
      ],
    }, 'Recovery in progress')}\n_ams_op:${JSON.stringify({ site_key: 'pp', channel: 'WS Business', owner: 'RM Executor 1' })}`,
    opNotes({
      site_key: 'my',
      channel: 'WS Normal',
      owner: 'RM Executor 1',
      linked_override: true,
    }, 'Demo phone mismatch — account +60199001298, SIM +60199001299'),
    opNotes({
      site_key: 'my',
      channel: 'WS Normal',
      owner: 'RM Executor 1',
      linked_override: true,
    }, 'Demo phone mismatch — account +60199001301, SIM +60199001302'),
    opNotes({
      site_key: 'my',
      channel: 'WS Business',
      owner: 'RM Executor 2',
      linked_override: true,
    }, 'Demo phone mismatch — account +60199001303, SIM +60199001304'),
  ]);

  const bindings = [
    [ids.acReg, ids.devMY1, ids.sim1, ids.ipMY1],
    [ids.acMan1, ids.devMY2, ids.sim2, ids.ipMY2],
    [ids.acMan3, ids.devMY2, ids.sim2, ids.ipMY2],
    [ids.acAuto, ids.devMY3, ids.sim6, ids.ipMY3],
    [ids.acAuto7, ids.devMY3, null, ids.ipMY3],
    [ids.acStandby, ids.devMY1, null, ids.ipMY2],
    [ids.acInUse, ids.devPP1, ids.sim4, ids.ipPP1],
    [ids.acRecovering, ids.devPP1, ids.sim5, ids.ipPP1],
    [ids.acAlignDemo, null, ids.simAlignDemo, null],
    [ids.acAlignDemo2, null, ids.simAlignDemo2, null],
    [ids.acAlignDemo3, null, ids.simAlignDemo3, null],
  ];
  for (const [acctId, devId, simId, ipId] of bindings) {
    await client.query(
      'UPDATE devices SET current_account_id = $1, current_ip_id = $2 WHERE id = $3',
      [acctId, ipId, devId],
    );
    if (simId) {
      await client.query('UPDATE sims SET current_account_id = $1 WHERE id = $2', [acctId, simId]);
    }
    await client.query(
      'UPDATE ips SET assigned_account_id = $1, assigned_device_id = $2 WHERE id = $3',
      [acctId, devId, ipId],
    );
  }

  await client.query(`
    INSERT INTO ip_gate_reviews (id, account_id, status, phone_ip_screenshot_url) VALUES
    ($1, $2, 'PENDING', 'seed/sample-screenshot-my.png'),
    ($3, $4, 'APPROVED', 'seed/sample-screenshot-pp.png')
  `, [ids.igrStandby, ids.acStandby, ids.igrInUse, ids.acInUse]);

  await client.query(`
    INSERT INTO tickets (title, description, status, account_id) VALUES
    ($1, $2, 'OPEN', $3),
    ($4, $5, 'IN_PROGRESS', $6)
  `, [
    'Delivery — SBMY-mey',
    `_ams_tkt:${JSON.stringify({
      site_key: 'my',
      link_code: '482910',
      delivery_stage: 'submitted',
      channel: 'WS Business',
      ip_gate_review_id: ids.igrStandby,
      shot_proxy: { ip_address: '103.21.44.26', port: '8080', username: 'user_my02', password: 'pass_my02' },
    })}`,
    ids.acStandby,
    'Delivery — PP-Ben',
    `_ams_tkt:${JSON.stringify({
      site_key: 'pp',
      link_code: '193847',
      delivery_stage: 'posted',
      channel: 'WS Normal',
      ip_gate_review_id: ids.igrInUse,
      review_match: true,
      shot_proxy: { ip_address: '175.100.8.70', port: '8080', username: 'user_pp01', password: 'pass_pp01' },
    })}`,
    ids.acInUse,
  ]);

  const summary = await client.query(`
    SELECT status, count(*)::int AS n FROM accounts GROUP BY status ORDER BY status
  `);

  console.log('\n✓ Sample data seeded (moderate set)\n');
  console.log('Accounts by status:');
  summary.rows.forEach((r) => console.log(`  ${r.status.padEnd(14)} ${r.n}`));
  console.log('\nFlow coverage:');
  console.log('  Activation  → SBMY-new01 (REGISTERING)');
  console.log('  Nurturing   → manual day 2, manual scan-ready, auto day 5, auto graduate-ready');
  console.log('  Standby     → SBMY-mey (AVAILABLE) + ticket awaiting review');
  console.log('  In use      → PP-Ben (IN_USE) + ticket posted');
  console.log('  Recovery    → SBMY-Cindy (BANNED), PP-Joyce (RECOVERING)');
  console.log('  Phone Align → 3 demos (click account name in SIM Ledger):');
  console.log('    SBMY-align-demo   account +60199001298 → SIM +60199001299');
  console.log('    SBMY-align-demo-2 account +60199001301 → SIM +60199001302');
  console.log('    SBMY-align-demo-3 account +60199001303 → SIM +60199001304');
  console.log('  Register    → 2 prepared SIMs in queue (MY)');
} catch (e) {
  console.error('✗ Seed failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
