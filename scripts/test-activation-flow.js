#!/usr/bin/env node
/**
 * T01.5 — Activation + QR workflow smoke test (API + FeedFlow bridge).
 * Usage: npm run test:activation
 *
 * Requires: npm run dev (API :4000, FeedFlow :47821)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i < 0) return;
    if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
  });
}

loadEnv(envPath);

const API = process.env.API_BASE || 'http://127.0.0.1:4000/api/v1';
const BRIDGE = process.env.BRIDGE_BASE || 'http://127.0.0.1:47821';
const USER = process.env.AMS_TEST_USER || 'xcrmbackend';
const PASS = process.env.AMS_TEST_PASSWORD || process.env.AMS_ADMIN_PASSWORD || 'AmsMaster2026!';

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function main() {
  console.log('\nT01.5 Activation + QR smoke test\n');

  let token = null;

  try {
    const { res, body } = await getJson(`${API}/health`);
    if (res.ok && body.ok) pass('API health', API);
    else fail('API health', `${res.status}`);
  } catch (e) {
    fail('API health', e.message);
    console.log('\nStart dev server: cd "AMS Project" && npm run dev\n');
    process.exit(1);
  }

  try {
    const { res, body } = await getJson(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    if (res.ok && body.access_token) {
      token = body.access_token;
      pass('Auth login', USER);
    } else {
      fail('Auth login', body.error || res.status);
    }
  } catch (e) {
    fail('Auth login', e.message);
  }

  const authHdr = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    const { res, body } = await getJson(`${API}/accounts?status=REGISTERING&limit=20`, {
      headers: authHdr,
    });
    if (res.ok) {
      const n = body?.data?.length ?? 0;
      pass('Activation queue API', `${n} REGISTERING account(s)`);
    } else fail('Activation queue API', res.status);
  } catch (e) {
    fail('Activation queue API', e.message);
  }

  try {
    const { res, body } = await getJson(`${API}/bridge/summary`, { headers: authHdr });
    if (res.ok) pass('Bridge summary API', `reachable=${body.reachable !== false}`);
    else fail('Bridge summary API', res.status);
  } catch (e) {
    fail('Bridge summary API', e.message);
  }

  try {
    const { res, body } = await getJson(`${BRIDGE}/api/health`);
    if (res.ok) pass('FeedFlow engine', body.version || 'online');
    else fail('FeedFlow engine', `HTTP ${res.status}`);
  } catch (e) {
    fail('FeedFlow engine', 'offline — run npm run dev for QR scan');
  }

  try {
    const { res, body } = await getJson(`${BRIDGE}/api/status`);
    if (res.ok) {
      const linked = (body.accounts || []).filter((a) => a.connected).length;
      pass('Engine slot status', `${linked} linked slot(s)`);
    } else fail('Engine slot status', res.status);
  } catch (e) {
    fail('Engine slot status', 'unavailable');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

  if (failed.some((r) => r.name === 'FeedFlow engine')) {
    console.log('\nManual QR test: Register → Activation (/link) → Show QR Code → scan on phone');
  }

  process.exit(failed.length ? 1 : 0);
}

main();
