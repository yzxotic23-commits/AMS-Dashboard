#!/usr/bin/env node
/**
 * Run a SQL migration against Supabase Postgres.
 * Usage:
 *   npm run migrate:supabase
 *   node scripts/run-migration.js supabase/migrations/007_profiles_site_key.sql
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

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

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

loadEnv(envPath);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes('YOUR-PASSWORD')) {
  fail('Missing DATABASE_URL in .env — copy the URI from Supabase Dashboard → Settings → Database');
}

const arg = process.argv[2];
const sqlPath = arg
  ? path.resolve(root, arg)
  : path.join(root, 'supabase/migrations/001_initial_schema.sql');

if (!fs.existsSync(sqlPath)) {
  fail(`Migration file not found: ${sqlPath}`);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
const label = path.relative(root, sqlPath);

try {
  console.log('Connecting to Supabase Postgres…');
  await client.connect();
  console.log(`Running migration (${label})…`);
  await client.query(sql);
  console.log('✓ Migration completed successfully');
} catch (e) {
  if (String(e.message).includes('already exists')) {
    console.log('⚠ Some objects already exist — migration may have been run before.');
  } else {
    fail(e.message);
  }
} finally {
  await client.end().catch(() => {});
}
