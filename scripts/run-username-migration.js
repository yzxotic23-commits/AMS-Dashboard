#!/usr/bin/env node
/** Apply 003_profiles_username.sql — Usage: npm run migrate:username */
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
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  });
}

loadEnv(envPath);
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/003_profiles_username.sql'), 'utf8');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.query(`UPDATE profiles SET username = 'admin' WHERE email = 'admin@ams.local'`);
await client.end();
console.log('✓ profiles.username migration applied');
