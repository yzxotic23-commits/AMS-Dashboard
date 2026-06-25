#!/usr/bin/env node
/**
 * Add (or refresh) phone-mismatch demo rows without wiping other data.
 * Usage: npm run seed:align-demo
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

export const ALIGN_DEMOS = [
  {
    account: 'SBMY-align-demo',
    simPhone: '+60199001299',
    accountPhone: '+60199001298',
    carrier: 'Tunetalk',
  },
  {
    account: 'SBMY-align-demo-2',
    simPhone: '+60199001302',
    accountPhone: '+60199001301',
    carrier: 'Tunetalk',
  },
  {
    account: 'SBMY-align-demo-3',
    simPhone: '+60199001304',
    accountPhone: '+60199001303',
    carrier: 'Digi',
  },
];

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

const SIM_PREFIX = '_ams_sim:';

function ledgerSimNotes(siteKey) {
  return `${SIM_PREFIX}${JSON.stringify({
    registered_at: new Date().toISOString(),
    site_key: siteKey,
  })}`;
}

loadEnv(path.join(root, '.env'));

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function upsertAlignDemo(demo) {
  const notes = opNotes({
    site_key: 'my',
    channel: 'WS Normal',
    owner: 'RM Executor 1',
    linked_override: true,
  }, `Demo phone mismatch — account ${demo.accountPhone}, SIM ${demo.simPhone}`);

  const simRow = await client.query(
    'SELECT id FROM sims WHERE phone_number = $1 LIMIT 1',
    [demo.simPhone],
  );
  let simId = simRow.rows[0]?.id;

  if (!simId) {
    simId = randomUUID();
    await client.query(
      `INSERT INTO sims (id, phone_number, carrier, status, notes)
       VALUES ($1, $2, $3, 'OK', $4)`,
      [simId, demo.simPhone, demo.carrier, ledgerSimNotes('my')],
    );
    console.log('  + SIM', demo.simPhone);
  } else {
    await client.query(
      `UPDATE sims SET notes = $1 WHERE id = $2`,
      [ledgerSimNotes('my'), simId],
    );
  }

  const existing = await client.query(
    'SELECT id FROM accounts WHERE account_name = $1 LIMIT 1',
    [demo.account],
  );
  let accountId = existing.rows[0]?.id;

  if (accountId) {
    await client.query(
      `UPDATE accounts
       SET phone_number = $1, sim_id = $2, status = 'AVAILABLE', notes = $3
       WHERE id = $4`,
      [demo.accountPhone, simId, notes, accountId],
    );
    console.log('  ~ account', demo.account);
  } else {
    accountId = randomUUID();
    await client.query(
      `INSERT INTO accounts (id, account_name, phone_number, status, sim_id, notes)
       VALUES ($1, $2, $3, 'AVAILABLE', $4, $5)`,
      [accountId, demo.account, demo.accountPhone, simId, notes],
    );
    console.log('  + account', demo.account);
  }

  await client.query(
    'UPDATE sims SET current_account_id = $1 WHERE id = $2',
    [accountId, simId],
  );

  return { account: demo.account, accountPhone: demo.accountPhone, simPhone: demo.simPhone };
}

try {
  await client.connect();
  console.log(`Seeding ${ALIGN_DEMOS.length} phone-align demos…\n`);

  const rows = [];
  for (const demo of ALIGN_DEMOS) {
    rows.push(await upsertAlignDemo(demo));
  }

  console.log('\n✓ Align demos ready (3 mismatches):');
  rows.forEach((row) => {
    console.log(`  ${row.account}: account ${row.accountPhone} → SIM ${row.simPhone}`);
  });
  console.log('\nOpen SIM Card Ledger → filter "Alignment issues only" → click account name → Align now');
} catch (e) {
  console.error('✗ Failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
