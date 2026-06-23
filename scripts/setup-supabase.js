#!/usr/bin/env node
/**
 * Verify AMS Supabase configuration and print setup steps.
 * Usage: npm run setup:supabase
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  });
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

loadEnv(envPath);

if (!fs.existsSync(envPath)) {
  fail(`Missing ${envPath} — copy .env.example to .env and fill Supabase credentials.`);
}

if (process.env.VITE_DEMO_MODE === 'true') {
  fail('VITE_DEMO_MODE is still true. Set VITE_DEMO_MODE=false in .env');
}

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];

const missing = required.filter((key) => {
  const val = process.env[key];
  return !val || val.includes('your-project') || val.includes('your-anon') || val.includes('your-service');
});

if (missing.length) {
  fail(`Incomplete .env keys: ${missing.join(', ')}\n  Open Supabase Dashboard → Project Settings → API`);
}

ok('Demo mode disabled');
ok('.env credentials look valid');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

try {
  const res = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (res.status === 404) {
    fail('Table `profiles` not found — run supabase/migrations/001_initial_schema.sql in Supabase SQL Editor');
  }
  if (!res.ok) {
    const body = await res.text();
    fail(`Supabase connection failed (${res.status}): ${body.slice(0, 200)}`);
  }
  ok('Connected to Supabase — profiles table exists');
} catch (e) {
  fail(`Cannot reach Supabase: ${e.message}`);
}

try {
  const bucketRes = await fetch(`${url}/storage/v1/bucket/ticket-screenshots`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (bucketRes.status === 404) {
    console.log('⚠ Storage bucket `ticket-screenshots` missing — run: npm run migrate:screenshots');
  } else if (!bucketRes.ok) {
    console.log(`⚠ Could not verify ticket-screenshots bucket (${bucketRes.status})`);
  } else {
    ok('Storage bucket ticket-screenshots exists');
  }
} catch (e) {
  console.log(`⚠ Storage check skipped: ${e.message}`);
}

console.log(`
Staff & login — semua lewat Supabase Dashboard (tanpa script JS):

  1. Supabase → Authentication → Users → Add user
     - Email + password (ini yang dipakai login AMS)
     - Auto confirm user: ON

  2. (Opsional) User Metadata saat create:
     {
       "full_name": "RM Executor 1",
       "role": "operator",
       "username": "rm01"
     }
     role: operator = staff AMS | business = submit tiket | admin

  3. Set role + password_hash (plain text, lihat di Table Editor → profiles):
     UPDATE public.profiles
     SET role = 'operator',
         full_name = 'RM Executor 1',
         password_hash = 'password-yang-sama-di-auth',
         is_active = true
     WHERE email = 'rm01@yourcompany.com';

  4. Lupa password → reset di Authentication → Users,
     lalu sync kolom password_hash di profiles dengan SQL di atas.

  5. Start AMS: npm run dev → login http://localhost:3000/login (email + password)

  Dev shortcut (opsional): npm run create:admin
`);
