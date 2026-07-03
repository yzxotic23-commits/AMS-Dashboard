#!/usr/bin/env node
/**
 * Set owner in accounts.notes metadata (_ams_op.owner).
 *
 * Usage:
 *   node scripts/assign-account-owner.js Bryan --status NURTURING
 *   node scripts/assign-account-owner.js Bryan --account Junaa
 *   node scripts/assign-account-owner.js Bryan --status NURTURING --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const META_PREFIX = '_ams_op:';

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
  try {
    return {
      human: text.slice(0, idx).trim(),
      meta: JSON.parse(text.slice(idx + META_PREFIX.length)),
    };
  } catch {
    return { human: text.trim(), meta: {} };
  }
}

function serializeNotes(human, meta) {
  const payload = `${META_PREFIX}${JSON.stringify(meta)}`;
  return human ? `${human}\n${payload}` : payload;
}

function parseArgs(argv) {
  const owner = argv[2];
  let status = null;
  let account = null;
  let apply = false;
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--status' && argv[i + 1]) {
      status = argv[i + 1].toUpperCase();
      i += 1;
    } else if (argv[i] === '--account' && argv[i + 1]) {
      account = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--apply') {
      apply = true;
    }
  }
  return { owner, status, account, apply };
}

loadEnv(path.join(root, '.env'));

const { owner, status, account, apply } = parseArgs(process.argv);
if (!owner) {
  console.error('Usage: node scripts/assign-account-owner.js <owner> [--status NURTURING] [--account name] [--apply]');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const opRes = await client.query(
  `SELECT id, full_name, username, site_key FROM profiles
   WHERE full_name ILIKE $1 OR username ILIKE $1
   ORDER BY full_name LIMIT 5`,
  [owner],
);
if (!opRes.rows.length) {
  console.error(`No profile found matching "${owner}"`);
  process.exit(1);
}
const op = opRes.rows[0];
const ownerLabel = String(op.full_name || op.username || owner).trim();
console.log(`Owner label: ${ownerLabel} (profile id ${op.id}, site ${op.site_key || '—'})`);

let q = 'SELECT id, account_name, status, notes FROM accounts WHERE 1=1';
const params = [];
if (status) {
  params.push(status);
  q += ` AND status = $${params.length}`;
}
if (account) {
  params.push(`%${account}%`);
  q += ` AND account_name ILIKE $${params.length}`;
}
q += ' ORDER BY account_name';

const { rows } = await client.query(q, params);
if (!rows.length) {
  console.error('No matching accounts');
  process.exit(1);
}

const updates = [];
for (const row of rows) {
  const { human, meta } = parseMeta(row.notes);
  const prev = meta.owner || '';
  if (prev === ownerLabel) {
    console.log(`· ${row.account_name} — already ${ownerLabel}`);
    continue;
  }
  const nextMeta = { ...meta, owner: ownerLabel };
  updates.push({
    id: row.id,
    name: row.account_name,
    prev: prev || '(empty)',
    notes: serializeNotes(human, nextMeta),
  });
}

if (!updates.length) {
  console.log('Nothing to update.');
  await client.end();
  process.exit(0);
}

console.log(`\nWill update ${updates.length} account(s):`);
updates.forEach((u) => console.log(`  ${u.name}: ${u.prev} → ${ownerLabel}`));

if (!apply) {
  console.log('\nDry run — pass --apply to write changes.');
  await client.end();
  process.exit(0);
}

for (const u of updates) {
  await client.query('UPDATE accounts SET notes = $1, updated_at = NOW() WHERE id = $2', [u.notes, u.id]);
}
console.log(`\n✓ Updated ${updates.length} account(s) to owner "${ownerLabel}"`);
await client.end();
