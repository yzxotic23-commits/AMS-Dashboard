/** SIM notes metadata — prepared queue + ledger top-up fields. */

import { parseOperatorMeta } from './accountMeta.js';

export const PREP_PREFIX = '_ams_prep:';
export const SIM_PREFIX = '_ams_sim:';

export const SIM_TOPUP_CYCLE_DAYS = 30;

export function parseSimNotesMeta(notes = '') {
  const text = String(notes || '');
  const prepIdx = text.indexOf(PREP_PREFIX);
  const simIdx = text.indexOf(SIM_PREFIX);
  let prepared = {};
  let ledger = {};
  if (prepIdx !== -1) {
    try {
      prepared = JSON.parse(text.slice(prepIdx + PREP_PREFIX.length).split('\n')[0]);
    } catch {
      prepared = {};
    }
  }
  if (simIdx !== -1) {
    try {
      ledger = JSON.parse(text.slice(simIdx + SIM_PREFIX.length).split('\n')[0]);
    } catch {
      ledger = {};
    }
  }
  const human = text
    .replace(new RegExp(`${PREP_PREFIX}[\\s\\S]*$`), '')
    .replace(new RegExp(`${SIM_PREFIX}[\\s\\S]*$`), '')
    .trim();
  return { prepared, ledger, human };
}

export function mergeSimLedgerMeta(notes, ledgerPatch) {
  const { prepared, ledger, human } = parseSimNotesMeta(notes);
  const nextLedger = { ...ledger, ...ledgerPatch };
  const parts = [];
  if (human) parts.push(human);
  if (Object.keys(prepared).length) parts.push(`${PREP_PREFIX}${JSON.stringify(prepared)}`);
  parts.push(`${SIM_PREFIX}${JSON.stringify(nextLedger)}`);
  return parts.join('\n');
}

export const SIM_TOPUP_CYCLE_OPTIONS = [30, 60, 90];
export const SIM_TOPUP_HISTORY_LIMIT = 50;

function newTopupId() {
  return `tu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize cycle to 30 / 60 / 90. */
export function normalizeTopupCycleDays(value, fallback = SIM_TOPUP_CYCLE_DAYS) {
  const n = parseInt(value, 10);
  if (SIM_TOPUP_CYCLE_OPTIONS.includes(n)) return n;
  return fallback;
}

/**
 * Append a charge event to ledger.topups and refresh last_* fields.
 * History lives in notes so it works without a new DB table.
 */
export function appendSimTopup(notes, {
  charged_at,
  amount = null,
  cycle_days = SIM_TOPUP_CYCLE_DAYS,
  plan = null,
  created_by = null,
} = {}) {
  const { ledger } = parseSimNotesMeta(notes);
  const cycle = normalizeTopupCycleDays(cycle_days, ledger.last_cycle_days || SIM_TOPUP_CYCLE_DAYS);
  const chargeDate = charged_at || new Date().toISOString().slice(0, 10);
  const expiry = expiryFromChargeDate(chargeDate, cycle);
  const amountNum = amount == null || amount === ''
    ? null
    : Number(amount);
  const entry = {
    id: newTopupId(),
    charged_at: chargeDate,
    amount: Number.isFinite(amountNum) ? amountNum : null,
    cycle_days: cycle,
    plan: plan ? String(plan).trim() : null,
    expiry_date: expiry,
    created_at: new Date().toISOString(),
    created_by: created_by || null,
  };
  const prev = Array.isArray(ledger.topups) ? ledger.topups : [];
  const topups = [entry, ...prev].slice(0, SIM_TOPUP_HISTORY_LIMIT);
  return {
    notes: mergeSimLedgerMeta(notes, {
      last_charged: chargeDate,
      last_amount: entry.amount,
      last_cycle_days: cycle,
      last_plan: entry.plan,
      ledger_status: 'active',
      topups,
    }),
    entry,
    expiry_date: expiry,
    cycle_days: cycle,
  };
}

export function listSimTopups(notes = {}) {
  const ledger = typeof notes === 'string'
    ? parseSimNotesMeta(notes).ledger
    : (notes || {});
  if (Array.isArray(ledger.topups) && ledger.topups.length) return ledger.topups;
  // Backfill a single legacy row from older Mark Charged (date-only) records.
  if (ledger.last_charged) {
    return [{
      id: 'legacy-last-charged',
      charged_at: ledger.last_charged,
      amount: ledger.last_amount ?? null,
      cycle_days: ledger.last_cycle_days || SIM_TOPUP_CYCLE_DAYS,
      plan: ledger.last_plan || null,
      expiry_date: expiryFromChargeDate(
        ledger.last_charged,
        ledger.last_cycle_days || SIM_TOPUP_CYCLE_DAYS,
      ),
      created_at: null,
      created_by: null,
    }];
  }
  return [];
}

/** Admin top-up workflow status (stored in notes, not DB enum). */
export const SIM_LEDGER_STATUSES = ['active', 'pending_review', 'stop_topup'];

export const SIM_LEDGER_STATUS_LABELS = {
  active: 'Active',
  pending_review: 'Pending Review',
  stop_topup: 'Stop Top-up',
};

export const SIM_EXCEPTION_REASONS = [
  { id: 'topup_failed', label: 'Top-up failed' },
  { id: 'number_suspended', label: 'Number suspended' },
  { id: 'account_ban_pending', label: 'Account banned (pending confirmation)' },
];

export function normalizeLedgerStatus(value) {
  const v = String(value || '').trim().toLowerCase();
  if (SIM_LEDGER_STATUSES.includes(v)) return v;
  return 'active';
}

export function setSimLedgerStatus(notes, status, {
  reason = null,
  created_by = null,
} = {}) {
  const next = normalizeLedgerStatus(status);
  return mergeSimLedgerMeta(notes, {
    ledger_status: next,
    ledger_status_reason: reason || null,
    ledger_status_updated_at: new Date().toISOString(),
    ledger_status_updated_by: created_by || null,
  });
}

/** Free-text remark for Admin / R&M handover (Google Sheets parity). */
export function setSimRemark(notes, remark, { created_by = null } = {}) {
  const text = remark == null ? '' : String(remark).trim();
  return mergeSimLedgerMeta(notes, {
    remark: text || null,
    remark_updated_at: new Date().toISOString(),
    remark_updated_by: created_by || null,
  });
}

/** Unable to Top Up — writes exception + may move to Pending Review. */
export function recordSimException(notes, {
  reason,
  detail = null,
  created_by = null,
} = {}) {
  const reasonId = String(reason || '').trim();
  if (!SIM_EXCEPTION_REASONS.some((r) => r.id === reasonId)) {
    throw new Error('Invalid exception reason');
  }
  const { ledger } = parseSimNotesMeta(notes);
  const entry = {
    id: `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    reason: reasonId,
    detail: detail ? String(detail).trim() : null,
    created_at: new Date().toISOString(),
    created_by: created_by || null,
  };
  const exceptions = [entry, ...(Array.isArray(ledger.exceptions) ? ledger.exceptions : [])].slice(0, 50);
  const nextStatus = reasonId === 'account_ban_pending'
    ? 'pending_review'
    : normalizeLedgerStatus(ledger.ledger_status);
  return {
    notes: mergeSimLedgerMeta(notes, {
      ledger_status: nextStatus,
      ledger_status_reason: reasonId,
      ledger_status_updated_at: entry.created_at,
      ledger_status_updated_by: created_by || null,
      last_exception: entry,
      exceptions,
    }),
    entry,
    ledger_status: nextStatus,
  };
}

/** Attach refund to a specific top-up history row. */
export function refundSimTopup(notes, topupId, {
  amount = null,
  reason = null,
  created_by = null,
} = {}) {
  const { ledger } = parseSimNotesMeta(notes);
  let topups = Array.isArray(ledger.topups) ? ledger.topups.map((t) => ({ ...t })) : [];

  if (!topups.length && ledger.last_charged && String(topupId) === 'legacy-last-charged') {
    topups = listSimTopups(notes).map((t) => ({ ...t }));
  }

  const idx = topups.findIndex((t) => String(t.id) === String(topupId));
  if (idx < 0) throw new Error('Top-up record not found');
  if (topups[idx].refund) throw new Error('This top-up is already refunded');

  const amountNum = amount == null || amount === ''
    ? topups[idx].amount
    : Number(amount);
  topups[idx] = {
    ...topups[idx],
    refund: {
      amount: Number.isFinite(amountNum) ? amountNum : null,
      reason: reason ? String(reason).trim() : null,
      created_at: new Date().toISOString(),
      created_by: created_by || null,
    },
  };

  return {
    notes: mergeSimLedgerMeta(notes, { topups }),
    entry: topups[idx],
  };
}

/** Prepared numbers queue — SIM row still waiting for registration. */
export function isPreparedQueueSim(notes = '') {
  return String(notes).includes(PREP_PREFIX);
}

/** Strip prep metadata and mark SIM as registered (enters SIM Card Ledger). */
export function promoteSimToLedgerNotes(notes, { site_key } = {}) {
  const { ledger, human } = parseSimNotesMeta(notes);
  const nextLedger = {
    ...ledger,
    registered_at: ledger.registered_at || new Date().toISOString(),
    ...(site_key ? { site_key } : {}),
  };
  const parts = [];
  if (human) parts.push(human);
  parts.push(`${SIM_PREFIX}${JSON.stringify(nextLedger)}`);
  return parts.join('\n');
}

/** Wireframe: SIM Card Ledger = registered numbers only (not prep queue). */
export function simLedgerEligible(sim, boundAccount) {
  if (boundAccount) return true;
  const { ledger } = parseSimNotesMeta(sim.notes);
  return Boolean(ledger.registered_at);
}

const SITE_NAMES = { my: 'Malaysia', pp: 'Poipet' };

export function inferSimSiteKey(sim) {
  const { ledger, prepared, human } = parseSimNotesMeta(sim?.notes);
  if (ledger.site_key === 'my' || ledger.site_key === 'pp') return ledger.site_key;
  if (prepared.site_key === 'my' || prepared.site_key === 'pp') return prepared.site_key;
  const loc = String(human || sim?.location || '').toLowerCase();
  if (loc.includes('poipet')) return 'pp';
  if (String(sim?.phone_number || '').startsWith('+855')) return 'pp';
  return 'my';
}

export function simSiteName(siteKey) {
  return SITE_NAMES[siteKey] || SITE_NAMES.my;
}

export function expiryFromChargeDate(chargeDate, cycleDays = SIM_TOPUP_CYCLE_DAYS) {
  const base = chargeDate ? new Date(`${chargeDate}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + cycleDays);
  return base.toISOString().slice(0, 10);
}

/** Prefer DB expiry_date; else derive from last charge + cycle in notes. */
export function resolveSimExpiryDate(sim, ledger = {}) {
  const raw = sim?.expiry_date || ledger.expiry_date || null;
  if (raw) {
    const iso = String(raw).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  if (ledger.last_charged) {
    return expiryFromChargeDate(
      ledger.last_charged,
      normalizeTopupCycleDays(ledger.last_cycle_days, SIM_TOPUP_CYCLE_DAYS),
    );
  }
  return null;
}

/** Days until expiry, or null when no expiry is known (do not fake 0). */
export function daysLeftFromExpiryDate(expiryIso) {
  if (!expiryIso) return null;
  const expiry = new Date(`${String(expiryIso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86400000));
}

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function resolveBoundAccount(sim, accountBySimId, accountByCurrentId, accountByPhoneDigits) {
  if (sim.current_account_id) {
    const byCurrent = accountByCurrentId.get(sim.current_account_id);
    if (byCurrent) return byCurrent;
  }
  const bySim = accountBySimId.get(sim.id);
  if (bySim) return bySim;
  const digits = phoneDigits(sim.phone_number);
  if (!digits) return null;
  return accountByPhoneDigits.get(digits)
    || accountByPhoneDigits.get(digits.slice(-9))
    || null;
}

/** True only when SIM is actually linked (not phone soft-match for display). */
export function isSimHardLinked(sim, accountBySimId = new Map(), accountByCurrentId = new Map()) {
  if (sim.current_account_id && accountByCurrentId.has(sim.current_account_id)) return true;
  if (accountBySimId.has(sim.id)) return true;
  return false;
}

function inferBrandFromName(accountName) {
  const m = String(accountName || '').match(/^(SBMY|JMMY|STMY|PP)\b/i);
  return m ? m[1].toUpperCase() : '';
}

function inferBrandFromDevice(deviceName) {
  const name = String(deviceName || '').toUpperCase();
  if (name.includes('-SB') || name.includes('SB-')) return 'SBMY';
  if (name.includes('-JM') || name.includes('JM-')) return 'JMMY';
  if (name.includes('-ST') || name.includes('ST-')) return 'STMY';
  if (name.startsWith('PP')) return 'STMY';
  return '';
}

/** Cost-attribution brand from bound account (meta → name → device). */
export function resolveAccountBrand(account) {
  if (!account) return '';
  const meta = parseOperatorMeta(account);
  if (meta.brand) return String(meta.brand).trim().toUpperCase();
  const deviceName = account.device_name
    || account.devices?.device_name
    || account.device?.device_name
    || '';
  return inferBrandFromName(account.account_name)
    || inferBrandFromDevice(deviceName)
    || '';
}

export function mapSimRow(sim, accountBySimId = new Map(), accountByCurrentId = new Map(), accountByPhoneDigits = new Map(), topupCountBySimId = new Map()) {
  const { ledger } = parseSimNotesMeta(sim.notes);
  const bound = resolveBoundAccount(sim, accountBySimId, accountByCurrentId, accountByPhoneDigits);
  const account_linked = isSimHardLinked(sim, accountBySimId, accountByCurrentId);
  const last_charged = sim.last_charged || ledger.last_charged || null;
  const last_cycle_days = sim.last_cycle_days || ledger.last_cycle_days || SIM_TOPUP_CYCLE_DAYS;
  const last_amount = sim.last_amount ?? ledger.last_amount ?? null;
  const last_plan = sim.last_plan || ledger.last_plan || null;
  const remark = sim.remark ?? ledger.remark ?? null;
  const remark_updated_at = sim.remark_updated_at || ledger.remark_updated_at || null;
  const remark_updated_by = sim.remark_updated_by || ledger.remark_updated_by || null;
  const ledger_status = normalizeLedgerStatus(sim.ledger_status || ledger.ledger_status);
  const last_exception = sim.last_exception || ledger.last_exception || null;
  const expiry_date = resolveSimExpiryDate(
    { ...sim, last_charged, last_cycle_days },
    { ...ledger, last_charged, last_cycle_days },
  );
  const daysLeft = daysLeftFromExpiryDate(expiry_date);
  const site_key = (sim.site_key === 'my' || sim.site_key === 'pp')
    ? sim.site_key
    : inferSimSiteKey(sim);
  const noteTopupCount = Array.isArray(ledger.topups)
    ? ledger.topups.length
    : (ledger.last_charged ? 1 : 0);
  const topup_count = topupCountBySimId.get(sim.id)
    ?? (last_charged ? Math.max(1, noteTopupCount) : noteTopupCount);
  return {
    ...sim,
    account_name: bound?.account_name || null,
    account_linked,
    brand: resolveAccountBrand(bound) || null,
    last_charged,
    last_amount,
    last_cycle_days,
    last_plan,
    topup_count,
    ledger_status,
    last_exception,
    remark,
    remark_updated_at,
    remark_updated_by,
    expiry_date,
    days_left: daysLeft,
    site_key,
    site_name: simSiteName(site_key),
    location: simSiteName(site_key),
  };
}
