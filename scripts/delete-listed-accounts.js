#!/usr/bin/env node
/**
 * Delete specific accounts by device + phone (from an ops list).
 *
 *   node scripts/delete-listed-accounts.js           # dry-run
 *   node scripts/delete-listed-accounts.js --apply   # delete
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const apply = process.argv.includes('--apply');

/** device_name, account_name (hint), phone digits without + */
const TARGETS = [
  ['MYR-SB-003', 'kelly', '601159175512'],
  ['MYR-SB-003', 'Natalie', '601159173442'],
  ['MYR-SB-004', 'Anson', '601159172471'],
  ['MYR-SB-004', 'tiffany', '601159177951'],
  ['MYR-SB-005', 'justin', '601159172948'],
  ['MYR-SB-005', 'wendy', '601159178428'],
  ['MYR-SB-006', 'melvin', '601159175263'],
  ['MYR-SB-006', 'crytal', '601159178323'],
  ['MYR-SB-007', 'cherry', '601159177060'],
  ['MYR-SB-007', 'jenny', '601159177828'],
  ['MYR-SB-008', 'sally', '601159179539'],
  ['MYR-SB-008', 'vivian', '601159179948'],
  ['MYR-SB-009', 'kitty', '601159163371'],
  ['MYR-SB-009', 'Karen', '601159178852'],
  ['MYR-SB-010', 'Ruby', '601159172409'],
  ['MYR-SB-010', 'oliver', '601159174578'],
  ['MYR-SB-011', 'candy', '601159171887'],
  ['MYR-SB-011', 'jesline', '601159173695'],
  ['MYR-SB-012', 'Maxie', '601159148563'],
  ['MYR-SB-012', 'zeo', '601159173543'],
  ['MYR-SB-013', 'mia', '601159157561'],
  ['MYR-SB-013', 'joelene', '601159172334'],
  ['MYR-SB-014', 'Nancy', '601159173989'],
  ['MYR-SB-014', 'kate', '601159156793'],
  ['MYR-SB-015', 'Elise', '601159172294'],
  ['MYR-SB-015', 'Estella', '601159178604'],
  ['MYR-SB-016', 'Iris', '601159179557'],
  ['MYR-SB-016', 'Clara', '601159174948'],
  ['MYR-SB-017', 'William', '601159180896'],
  ['MYR-SB-017', 'Kiwi', '601159179549'],
  ['MYR-SB-018', 'Zuvia', '601159179653'],
  ['MYR-SB-018', 'Helly', '601159170204'],
  ['MYR-SB-020', 'Rane', '601159139815'],
  ['MYR-SB-020', 'Melody', '601159149536'],
  ['MYR-SB-025', 'Mika', '601159176893'],
  ['MYR-SB-027', 'Mandy', '601159153073'],
  ['MYR-SB-034', 'Arman', '601159149516'],
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

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
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
    SELECT a.id, a.account_name, a.status, a.phone_number, a.device_id,
           d.device_name,
           s.phone_number AS sim_phone
    FROM accounts a
    LEFT JOIN devices d ON d.id = a.device_id
    LEFT JOIN sims s ON s.id = a.sim_id
  `);

  const toDelete = [];
  const missing = [];

  for (const [deviceName, nameHint, phone] of TARGETS) {
    const wantPhone = phoneDigits(phone);
    const matches = rows.filter((r) => {
      if (r.device_name !== deviceName) return false;
      const p = phoneDigits(r.phone_number) || phoneDigits(r.sim_phone);
      return p.endsWith(wantPhone) || p === wantPhone;
    });

    if (matches.length === 0) {
      missing.push({ deviceName, nameHint, phone });
      continue;
    }
    if (matches.length > 1) {
      console.warn(`Multiple matches for ${deviceName} ${phone}:`, matches.map((m) => m.account_name));
    }
    const pick = matches.find((m) =>
      m.account_name?.toLowerCase() === nameHint.toLowerCase(),
    ) || matches[0];
    if (!toDelete.some((d) => d.id === pick.id)) {
      toDelete.push(pick);
    }
  }

  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} — ${toDelete.length} account(s) matched, ${missing.length} not found\n`);

  toDelete.forEach((a) => {
    const ph = phoneDigits(a.phone_number) || phoneDigits(a.sim_phone) || '—';
    console.log(`  DELETE ${a.device_name} · ${a.account_name} · ${ph} [${a.status}]`);
  });

  if (missing.length) {
    console.log('\nNot found:');
    missing.forEach((m) => console.log(`  - ${m.deviceName} ${m.nameHint} ${m.phone}`));
  }

  if (!toDelete.length) {
    console.log('\nNothing to delete.');
    process.exit(0);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to delete.');
    process.exit(0);
  }

  await client.query('BEGIN');
  const ids = toDelete.map((a) => a.id);
  await clearBindings(ids);
  const del = await client.query(
    'DELETE FROM accounts WHERE id = ANY($1::uuid[]) RETURNING id, account_name',
    [ids],
  );
  await client.query('COMMIT');
  console.log(`\n✓ Deleted ${del.rowCount} account(s).`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('✗ Failed:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
