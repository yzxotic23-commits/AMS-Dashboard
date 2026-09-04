import { supabaseAdmin } from './supabase.js';
import { parseTicketMeta } from './ticketMeta.js';
import { SHARED_SESSION_CAP } from './accountType.js';

/** Append-only usage ledger for Brand-shared (and optional personal) accounts. */

export async function appendAccountUsageEvent({
  accountId,
  actorId,
  actorName = null,
  action,
  ticketId = null,
  occurredAt = null,
  metadata = null,
}) {
  if (!accountId || !action) {
    throw new Error('accountId and action are required for usage events');
  }
  const row = {
    account_id: accountId,
    actor_id: actorId || null,
    actor_name: actorName ? String(actorName).trim() : null,
    action: String(action).trim(),
    ticket_id: ticketId || null,
    occurred_at: occurredAt || new Date().toISOString(),
    metadata: metadata && typeof metadata === 'object' ? metadata : null,
  };
  const { data, error } = await supabaseAdmin
    .from('account_usage_events')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    // Table may not exist yet on older deploys — don't hard-fail delivery.
    if (/relation|does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[account_usage_events]', error.message);
      return null;
    }
    throw error;
  }
  return data;
}

export async function listAccountUsageEvents(accountId, { limit = 50 } = {}) {
  if (!accountId) return [];
  const { data, error } = await supabaseAdmin
    .from('account_usage_events')
    .select('*')
    .eq('account_id', accountId)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message || '')) return [];
    throw error;
  }
  return data || [];
}

/**
 * Active shared holders = distinct requesters on tickets still in posted / in-use
 * (ticket status IN_PROGRESS, delivery_stage posted).
 */
export async function countActiveSharedHolders(accountId) {
  if (!accountId) return 0;
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .select('id, status, requester_id, description')
    .eq('account_id', accountId)
    .eq('status', 'IN_PROGRESS')
    .limit(100);
  if (error) throw error;
  const requesters = new Set();
  (data || []).forEach((t) => {
    const stage = parseTicketMeta(t).delivery_stage;
    if (stage && stage !== 'posted') return;
    if (t.requester_id) requesters.add(t.requester_id);
    else requesters.add(t.id);
  });
  return requesters.size;
}

export async function assertSharedSessionCap(accountId, { extraRequesterId = null } = {}) {
  const active = await countActiveSharedHolders(accountId);
  // If this requester already holds a posted ticket, they don't consume a new slot.
  if (extraRequesterId) {
    const { data } = await supabaseAdmin
      .from('tickets')
      .select('id, requester_id, description, status')
      .eq('account_id', accountId)
      .eq('status', 'IN_PROGRESS')
      .eq('requester_id', extraRequesterId)
      .limit(5);
    const already = (data || []).some((t) => {
      const stage = parseTicketMeta(t).delivery_stage;
      return !stage || stage === 'posted';
    });
    if (already) return active;
  }
  if (active >= SHARED_SESSION_CAP) {
    const err = new Error(
      `This Brand-shared account already has ${SHARED_SESSION_CAP} active sessions (WhatsApp platform limit)`,
    );
    err.status = 409;
    throw err;
  }
  return active;
}

export function usageActorFromReq(req) {
  return {
    actorId: req.profile?.id || req.user?.id || null,
    actorName: req.profile?.full_name || req.profile?.username || null,
  };
}
