#!/usr/bin/env node
/**
 * Reset a delivery ticket + linked account back to standby for re-testing.
 * Usage: node scripts/reset-ticket-delivery.js [ticket_number_or_uuid]
 * Default: latest ticket in DB.
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
    if (i === -1) return;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  });
}

loadEnv(envPath);

const { supabaseAdmin } = await import('../apps/api/src/lib/supabase.js');
const { parseTicketMeta, serializeTicketDescription } = await import('../apps/api/src/lib/ticketMeta.js');

const arg = process.argv[2];

async function findTicket() {
  if (arg) {
    const byId = await supabaseAdmin.from('tickets').select('*').eq('id', arg).maybeSingle();
    if (byId.data) return byId.data;
    const byNo = await supabaseAdmin.from('tickets').select('*').eq('ticket_number', arg).maybeSingle();
    if (byNo.data) return byNo.data;
    throw new Error(`Ticket not found: ${arg}`);
  }
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No tickets in database');
  return data;
}

const ticket = await findTicket();
const meta = parseTicketMeta(ticket);

meta.delivery_stage = 'submitted';
meta.reject_reason = '';
delete meta.review_match;

const { error: ticketErr } = await supabaseAdmin
  .from('tickets')
  .update({
    status: 'OPEN',
    assignee_id: null,
    closed_at: null,
    description: serializeTicketDescription('', meta),
  })
  .eq('id', ticket.id);
if (ticketErr) throw ticketErr;

if (ticket.account_id) {
  const { error: acctErr } = await supabaseAdmin
    .from('accounts')
    .update({ status: 'AVAILABLE' })
    .eq('id', ticket.account_id);
  if (acctErr) throw acctErr;
}

if (meta.ip_gate_review_id) {
  const { error: igErr } = await supabaseAdmin
    .from('ip_gate_reviews')
    .update({
      status: 'PENDING',
      reviewer_id: null,
      reviewed_at: null,
      review_note: null,
    })
    .eq('id', meta.ip_gate_review_id);
  if (igErr) throw igErr;
}

console.log('✓ Ticket reset for delivery re-test');
console.log(`  Ticket:  ${ticket.ticket_number} (${ticket.id})`);
console.log(`  Account: ${ticket.account_id} → AVAILABLE`);
console.log(`  Stage:   submitted (review pending)`);
console.log(`  IP gate: ${meta.ip_gate_review_id || '—'} → PENDING`);
console.log('\nTest flow: Business view → already submitted | Operator → Match → Go live → Business → Confirm');
