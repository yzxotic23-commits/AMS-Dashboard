#!/usr/bin/env node
/**
 * Seed pipeline operator accounts (Supabase Auth + profiles).
 * Usage: npm run seed:operators
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

const DEFAULT_PASSWORD = process.env.AMS_OPERATOR_PASSWORD || 'AmsOperator2026!';

const OPERATORS = [
  { username: 'rm-exec-1-my', full_name: 'RM Executor 1', site_key: 'my' },
  { username: 'rm-exec-2-my', full_name: 'RM Executor 2', site_key: 'my' },
  { username: 'rm-exec-1-pp', full_name: 'RM Executor 1', site_key: 'pp' },
  { username: 'rm-exec-2-pp', full_name: 'RM Executor 2', site_key: 'pp' },
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

loadEnv(envPath);

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

function authEmail(username) {
  return `${username.toLowerCase()}@ams.internal`;
}

async function listAuthUsers() {
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!res.ok) throw new Error(`List users failed: ${res.status}`);
  const data = await res.json();
  return data.users || [];
}

async function createAuthUser({ username, full_name, password }) {
  const email = authEmail(username);
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: 'operator', username },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.msg || body.message || `Create user failed: ${res.status}`);
  return body;
}

async function resetAuthPassword(userId, password) {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || `Reset password failed: ${res.status}`);
  }
}

async function upsertProfile(client, row) {
  await client.query(
    `INSERT INTO profiles (id, email, username, full_name, role, site_key, is_active, password_hash)
     VALUES ($1, $2, $3, $4, 'operator'::user_role, $5, true, $6)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       username = EXCLUDED.username,
       full_name = EXCLUDED.full_name,
       role = 'operator',
       site_key = EXCLUDED.site_key,
       is_active = true,
       password_hash = EXCLUDED.password_hash,
       updated_at = NOW()`,
    [row.id, row.email, row.username, row.full_name, row.site_key, row.password_hash],
  );
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const existing = await listAuthUsers();
const created = [];

try {
  for (const op of OPERATORS) {
    const email = authEmail(op.username);
    let user = existing.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) {
      console.log(`↻ Exists: ${op.full_name} (@${op.username}) — updating profile & password`);
      await resetAuthPassword(user.id, DEFAULT_PASSWORD);
    } else {
      console.log(`+ Create: ${op.full_name} (@${op.username}) · site ${op.site_key.toUpperCase()}`);
      user = await createAuthUser({
        username: op.username,
        full_name: op.full_name,
        password: DEFAULT_PASSWORD,
      });
    }
    await upsertProfile(client, {
      id: user.id,
      email,
      username: op.username.toLowerCase(),
      full_name: op.full_name,
      site_key: op.site_key,
      password_hash: DEFAULT_PASSWORD,
    });
    created.push({ ...op, email });
  }
} finally {
  await client.end();
}

console.log('\n✓ Operator accounts ready\n');
console.log('  Password (all):', DEFAULT_PASSWORD);
console.log('');
for (const row of created) {
  const site = row.site_key === 'my' ? 'Malaysia' : 'Poipet';
  console.log(`  ${row.full_name.padEnd(16)} ${site.padEnd(10)} login: ${row.username}`);
}
console.log('');
