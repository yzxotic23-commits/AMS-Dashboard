#!/usr/bin/env node
/**
 * Push AMS account IP bindings → FeedFlow engine slot proxies.
 * Usage:
 *   node scripts/sync-feedflow-proxies.js [--apply]
 *   node scripts/sync-feedflow-proxies.js --apply --production
 *   node scripts/sync-feedflow-proxies.js --apply --engine https://your-railway-url
 */
import fs from 'fs';
import pg from 'pg';

const PRODUCTION_ENGINE = 'https://wsaf-bo-production.up.railway.app';

const APPLY = process.argv.includes('--apply');
const USE_PRODUCTION = process.argv.includes('--production');
const accountFilter = (() => {
  const i = process.argv.indexOf('--account');
  return i >= 0 ? String(process.argv[i + 1] || '').toLowerCase() : '';
})();
const engineArg = (() => {
  const i = process.argv.indexOf('--engine');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();

function loadEnv() {
  const path = new URL('../.env', import.meta.url);
  if (!fs.existsSync(path)) throw new Error('Missing .env');
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function proxyUrlFromIp(ip) {
  const user = encodeURIComponent(ip.username || '');
  const pass = encodeURIComponent(ip.password || '');
  const host = String(ip.ip_address).trim();
  const port = ip.port || '1081';
  return `socks5://${user}:${pass}@${host}:${port}`;
}

loadEnv();

let engine = (engineArg
  || (USE_PRODUCTION ? PRODUCTION_ENGINE : '')
  || process.env.WSAF_BRIDGE_URL
  || process.env.VITE_WSAF_BRIDGE_URL
  || '').replace(/\/$/, '');

if (!engine) {
  console.error('Set WSAF_BRIDGE_URL in .env, or pass --production / --engine <url>');
  process.exit(1);
}

if (/127\.0\.0\.1|localhost/i.test(engine)) {
  console.error(`Engine URL is local (${engine}) — nothing is listening there for cloud FeedFlow.`);
  console.error('Re-run with: node scripts/sync-feedflow-proxies.js --apply --production');
  process.exit(1);
}

console.log(`Engine: ${engine}`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT a.account_name, a.wsaf_slot, i.ip_address, i.port, i.username, i.password
  FROM accounts a
  JOIN ips i ON i.id = a.ip_id
  WHERE a.wsaf_slot IS NOT NULL
    AND a.ip_id IS NOT NULL
  ORDER BY a.wsaf_slot
`);
await pool.end();

const targets = rows.filter((r) =>
  !accountFilter || String(r.account_name).toLowerCase().includes(accountFilter),
);

if (!targets.length) {
  console.log('No accounts with wsaf_slot + ip_id found.');
  process.exit(0);
}

for (const row of targets) {
  const masked = `${row.ip_address}:${row.port || 1081}`;
  const line = `${row.account_name} slot ${row.wsaf_slot} → ${masked}`;
  if (!APPLY) {
    console.log(`[dry-run] ${line}`);
    continue;
  }
  const res = await fetch(`${engine}/api/slots/${row.wsaf_slot}/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-FeedFlow-Client': 'ams-bridge',
    },
    body: JSON.stringify({ proxyUrl: proxyUrlFromIp(row) }),
  });
  const data = await res.json().catch(() => ({}));
  console.log(res.ok ? `✓ ${line} → ${data.proxy || 'ok'}` : `✗ ${line} — ${data.error || res.status}`);
}

if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to push to engine.');
}
