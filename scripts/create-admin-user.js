#!/usr/bin/env node
/**
 * Create default AMS master admin in Supabase Auth + profiles.
 * Usage: npm run create:admin
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

const DEFAULT_EMAIL = process.env.AMS_ADMIN_EMAIL || 'admin@ams.local';
const DEFAULT_USERNAME = process.env.AMS_ADMIN_USERNAME || 'admin';
const DEFAULT_PASSWORD = process.env.AMS_ADMIN_PASSWORD || 'AmsMaster2026!';
const DEFAULT_NAME = 'AMS Master Admin';

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

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function findUserByEmail(email) {
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!res.ok) throw new Error(`List users failed: ${res.status}`);
  const data = await res.json();
  return (data.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function createUser() {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: DEFAULT_EMAIL,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: DEFAULT_NAME, role: 'admin', username: DEFAULT_USERNAME },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 422 || body?.msg?.includes('already')) {
      return findUserByEmail(DEFAULT_EMAIL);
    }
    throw new Error(body.msg || body.message || `Create user failed: ${res.status}`);
  }
  return body;
}

async function resetPassword(userId) {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password: DEFAULT_PASSWORD, email_confirm: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || `Reset password failed: ${res.status}`);
  }
}

let user = await findUserByEmail(DEFAULT_EMAIL);
if (user) {
  console.log(`User exists: ${DEFAULT_EMAIL} — resetting password & promoting admin`);
  await resetPassword(user.id);
} else {
  console.log(`Creating user: ${DEFAULT_EMAIL}`);
  user = await createUser();
}

if (!user?.id) {
  console.error('Could not resolve user id');
  process.exit(1);
}

if (dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(
    `INSERT INTO profiles (id, email, username, full_name, role, is_active, password_hash)
     VALUES ($1, $2, $3, $4, 'admin', true, $5)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       username = EXCLUDED.username,
       full_name = EXCLUDED.full_name,
       role = 'admin',
       is_active = true,
       password_hash = EXCLUDED.password_hash,
       updated_at = NOW()`,
    [user.id, DEFAULT_EMAIL, DEFAULT_USERNAME.toLowerCase(), DEFAULT_NAME, DEFAULT_PASSWORD],
  );
  await client.end();
} else {
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      email: DEFAULT_EMAIL,
      full_name: DEFAULT_NAME,
      username: DEFAULT_USERNAME.toLowerCase(),
      role: 'admin',
      is_active: true,
      password_hash: DEFAULT_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Profile update failed: ${res.status}`);
}

console.log('\n✓ Master admin ready');
console.log(`  Username: ${DEFAULT_USERNAME.toLowerCase()}`);
console.log(`  Password: ${DEFAULT_PASSWORD}`);
console.log('  Login:    http://localhost:3000/login\n');
