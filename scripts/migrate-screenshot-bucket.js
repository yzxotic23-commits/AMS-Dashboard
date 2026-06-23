#!/usr/bin/env node
/**
 * Create private Supabase storage bucket for ticket IP screenshots.
 * Usage: npm run migrate:screenshots
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

loadEnv(envPath);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const sqlPath = path.join(root, 'supabase/migrations/004_ticket_screenshot_storage.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(
    "SELECT id, name, public FROM storage.buckets WHERE id = 'ticket-screenshots'",
  );
  console.log(rows[0] ? `✓ Bucket ready: ${rows[0].id}` : '✗ Bucket not found after migration');
} catch (e) {
  console.error('✗', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
