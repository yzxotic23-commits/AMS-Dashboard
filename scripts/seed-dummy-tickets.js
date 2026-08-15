#!/usr/bin/env node
/**
 * Insert dummy delivery tickets for localhost alert / Waiting-Process testing.
 * Does NOT change account status (stays AVAILABLE) — safe to delete later.
 *
 * Usage:
 *   node scripts/seed-dummy-tickets.js
 *   node scripts/seed-dummy-tickets.js --cleanup
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  });
}

loadEnv(path.join(root, '.env'));

const { supabaseAdmin } = await import('../apps/api/src/lib/supabase.js');
const { serializeTicketDescription, parseTicketMeta } = await import('../apps/api/src/lib/ticketMeta.js');

const DUMMY_MARKER = '[DUMMY-ALERT-TEST]';
const cleanup = process.argv.includes('--cleanup');

function agoIso(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function parseStaff(notes) {
  const raw = String(notes || '');
  const idx = raw.indexOf('_ams_op:');
  if (idx === -1) return '';
  try {
    return String(JSON.parse(raw.slice(idx + '_ams_op:'.length)).staff || '').trim();
  } catch {
    return '';
  }
}

function parseSite(notes) {
  const raw = String(notes || '');
  const idx = raw.indexOf('_ams_op:');
  if (idx === -1) return 'my';
  try {
    return JSON.parse(raw.slice(idx + '_ams_op:'.length)).site_key || 'my';
  } catch {
    return 'my';
  }
}

if (cleanup) {
  const { data: rows, error } = await supabaseAdmin
    .from('tickets')
    .select('id, title, description')
    .ilike('title', `%${DUMMY_MARKER}%`);
  if (error) throw error;
  const ids = (rows || []).map((r) => r.id);
  const reviewIds = (rows || [])
    .map((r) => parseTicketMeta(r).ip_gate_review_id)
    .filter(Boolean);
  if (reviewIds.length) {
    await supabaseAdmin.from('ip_gate_reviews').delete().in('id', reviewIds);
  }
  if (ids.length) {
    const { error: delErr } = await supabaseAdmin.from('tickets').delete().in('id', ids);
    if (delErr) throw delErr;
  }
  console.log(`Cleaned ${ids.length} dummy ticket(s).`);
  process.exit(0);
}

const { data: accounts, error: accErr } = await supabaseAdmin
  .from('accounts')
  .select('id, account_name, status, notes, phone_number')
  .eq('status', 'AVAILABLE')
  .limit(40);
if (accErr) throw accErr;

const pool = (accounts || []).filter((a) => parseStaff(a.notes));
if (pool.length < 3) {
  console.error('Need at least 3 AVAILABLE accounts with Staff assigned.');
  process.exit(1);
}

const samples = [
  {
    label: 'fresh-25m',
    submittedAgoMs: 25 * 60_000,
    account: pool[0],
  },
  {
    label: 'waiting-2h',
    submittedAgoMs: 2 * 3600_000,
    account: pool[1],
  },
  {
    label: 'overdue-6h',
    submittedAgoMs: 6 * 3600_000,
    account: pool[2],
  },
];

// Optional posted + done samples if more accounts available
if (pool[3]) {
  samples.push({
    label: 'in-progress-40m',
    submittedAgoMs: 3 * 3600_000,
    progressAfterMs: 40 * 60_000,
    stage: 'posted',
    status: 'IN_PROGRESS',
    account: pool[3],
  });
}
if (pool[4]) {
  samples.push({
    label: 'done-2h-process',
    submittedAgoMs: 8 * 3600_000,
    progressAfterMs: 30 * 60_000,
    closedAfterMs: 2 * 3600_000,
    stage: 'done',
    status: 'RESOLVED',
    account: pool[4],
  });
}

const created = [];

for (const sample of samples) {
  const account = sample.account;
  const site = parseSite(account.notes);
  const submittedAt = agoIso(sample.submittedAgoMs);
  const stage = sample.stage || 'submitted';
  const status = sample.status || 'OPEN';

  const reviewId = randomUUID();
  const { error: revErr } = await supabaseAdmin.from('ip_gate_reviews').insert({
    id: reviewId,
    account_id: account.id,
    status: stage === 'submitted' ? 'PENDING' : 'APPROVED',
    submitted_by: null,
    phone_ip_screenshot_url: 'upload://dummy-alert-test',
    created_at: submittedAt,
  });
  if (revErr) throw revErr;

  const meta = {
    site_key: site,
    delivery_stage: stage,
    submitted_at: submittedAt,
    link_code: '88888888',
    shot_proxy: {
      ip_address: '103.21.44.15',
      port: '8080',
      username: 'dummy_user',
      password: 'dummy_pass',
    },
    channel: 'WS Normal',
    device_name: 'DUMMY-TEST',
    ip_gate_review_id: reviewId,
    reject_reason: '',
    dummy: true,
    dummy_label: sample.label,
  };

  if (sample.progressAfterMs != null) {
    meta.in_progress_at = new Date(
      Date.now() - sample.submittedAgoMs + sample.progressAfterMs,
    ).toISOString();
  }
  if (sample.closedAfterMs != null) {
    meta.closed_at = new Date(
      Date.now() - sample.submittedAgoMs + sample.closedAfterMs,
    ).toISOString();
  }

  const ticketId = randomUUID();
  const short = ticketId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const row = {
    id: ticketId,
    ticket_number: `TKT-DUM${short.slice(0, 5)}`,
    title: `${DUMMY_MARKER} ${sample.label} — ${account.account_name}`,
    description: serializeTicketDescription('Dummy ticket for alert / timing QA', meta),
    status,
    requester_id: null,
    account_id: account.id,
    created_at: submittedAt,
    closed_at: meta.closed_at || null,
  };

  const { data: ticket, error: tkErr } = await supabaseAdmin
    .from('tickets')
    .insert(row)
    .select('id, ticket_number, title, status, created_at')
    .single();
  if (tkErr) throw tkErr;

  created.push({
    ...ticket,
    stage,
    waitingOrProcess:
      stage === 'submitted'
        ? `Waiting ~${Math.round(sample.submittedAgoMs / 60000)}m`
        : `Process ~${Math.round((sample.closedAfterMs || sample.progressAfterMs) / 60000)}m`,
  });
}

console.log('\nDummy tickets created:\n');
for (const t of created) {
  console.log(`- ${t.ticket_number}  [${t.stage}]  ${t.waitingOrProcess}`);
  console.log(`  ${t.title}`);
}
console.log('\nRefresh AMS (operator/admin):');
console.log('1. Header ticket bell should chime every ~10s (pending dummies).');
console.log('2. /tickets shows Waiting / Process under Submitted.');
console.log('\nCleanup later:');
console.log('  node scripts/seed-dummy-tickets.js --cleanup\n');
