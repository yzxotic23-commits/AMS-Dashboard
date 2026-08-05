/** SIM ledger helpers that target Supabase columns / sim_topups (not notes JSON). */

import {
  expiryFromChargeDate,
  listSimTopups as listSimTopupsFromNotes,
  normalizeLedgerStatus,
  normalizeTopupCycleDays,
  parseSimNotesMeta,
  SIM_EXCEPTION_REASONS,
  SIM_TOPUP_CYCLE_DAYS,
} from './simMeta.js';
import { supabaseAdmin } from './supabase.js';

export function buildTopupEntry({
  charged_at,
  amount = null,
  cycle_days = SIM_TOPUP_CYCLE_DAYS,
  plan = null,
  created_by = null,
  prev_cycle_days = SIM_TOPUP_CYCLE_DAYS,
} = {}) {
  const cycle = normalizeTopupCycleDays(cycle_days, prev_cycle_days || SIM_TOPUP_CYCLE_DAYS);
  const chargeDate = charged_at || new Date().toISOString().slice(0, 10);
  const expiry = expiryFromChargeDate(chargeDate, cycle);
  const amountNum = amount == null || amount === '' ? null : Number(amount);
  return {
    charged_at: chargeDate,
    amount: Number.isFinite(amountNum) ? amountNum : null,
    cycle_days: cycle,
    plan: plan ? String(plan).trim() : null,
    expiry_date: expiry,
    created_by: created_by || null,
  };
}

export function mapTopupRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    charged_at: row.charged_at,
    amount: row.amount == null ? null : Number(row.amount),
    cycle_days: row.cycle_days || SIM_TOPUP_CYCLE_DAYS,
    plan: row.plan || null,
    expiry_date: row.expiry_date || null,
    created_at: row.created_at || null,
    created_by: row.created_by || null,
    refund: row.refund || null,
  };
}

/** Prefer sim_topups table; fall back to legacy notes history. */
export async function listSimTopupsForSim(sim) {
  if (!sim?.id) return [];
  const { data, error } = await supabaseAdmin
    .from('sim_topups')
    .select('*')
    .eq('sim_id', sim.id)
    .order('charged_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  if (!error && Array.isArray(data) && data.length) {
    return data.map(mapTopupRow);
  }

  // Table missing / empty → legacy notes
  if (error && !/relation|does not exist|schema cache/i.test(error.message || '')) {
    throw error;
  }
  return listSimTopupsFromNotes(sim.notes);
}

export async function loadTopupCounts(simIds = []) {
  const map = new Map();
  const ids = [...new Set(simIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data, error } = await supabaseAdmin
    .from('sim_topups')
    .select('sim_id')
    .in('sim_id', ids);
  if (error || !data) return map;
  data.forEach((row) => {
    map.set(row.sim_id, (map.get(row.sim_id) || 0) + 1);
  });
  return map;
}

export function buildRemarkPatch(remark, created_by = null) {
  const text = remark == null ? '' : String(remark).trim();
  return {
    remark: text || null,
    remark_updated_at: new Date().toISOString(),
    remark_updated_by: created_by || null,
  };
}

export function buildLedgerStatusPatch(status, {
  reason = null,
  created_by = null,
} = {}) {
  return {
    ledger_status: normalizeLedgerStatus(status),
  };
}

export function buildExceptionPatch({
  reason,
  detail = null,
  created_by = null,
  current_ledger_status = 'active',
} = {}) {
  const reasonId = String(reason || '').trim();
  if (!SIM_EXCEPTION_REASONS.some((r) => r.id === reasonId)) {
    throw new Error('Invalid exception reason');
  }
  const entry = {
    id: `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    reason: reasonId,
    detail: detail ? String(detail).trim() : null,
    created_at: new Date().toISOString(),
    created_by: created_by || null,
  };
  const nextStatus = reasonId === 'account_ban_pending'
    ? 'pending_review'
    : normalizeLedgerStatus(current_ledger_status);
  return {
    patch: {
      ledger_status: nextStatus,
      last_exception: entry,
    },
    entry,
    ledger_status: nextStatus,
  };
}

/** Merge DB columns with legacy notes ledger for mapSimRow. */
export function resolveLedgerFields(sim) {
  const { ledger } = parseSimNotesMeta(sim?.notes);
  const last_charged = sim?.last_charged || ledger.last_charged || null;
  return {
    ledger,
    last_charged,
    last_amount: sim?.last_amount ?? ledger.last_amount ?? null,
    last_cycle_days: sim?.last_cycle_days || ledger.last_cycle_days || SIM_TOPUP_CYCLE_DAYS,
    last_plan: sim?.last_plan || ledger.last_plan || null,
    ledger_status: normalizeLedgerStatus(sim?.ledger_status || ledger.ledger_status),
    last_exception: sim?.last_exception || ledger.last_exception || null,
    remark: sim?.remark ?? ledger.remark ?? null,
    remark_updated_at: sim?.remark_updated_at || ledger.remark_updated_at || null,
    remark_updated_by: sim?.remark_updated_by || ledger.remark_updated_by || null,
    site_key: sim?.site_key || ledger.site_key || null,
  };
}
