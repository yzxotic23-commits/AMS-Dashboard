/** Parse SIM notes metadata (_ams_prep / _ams_sim) and human-readable location. */

const PREP_PREFIX = '_ams_prep:';
const SIM_PREFIX = '_ams_sim:';

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

export function simLocationLabel(row, siteNames = { my: 'Malaysia', pp: 'Poipet' }) {
  const { prepared, ledger } = parseSimNotesMeta(row?.notes);
  if (ledger.site_key && siteNames[ledger.site_key]) return siteNames[ledger.site_key];
  if (prepared.site_key && siteNames[prepared.site_key]) return siteNames[prepared.site_key];
  if (row?.site_name) return row.site_name;
  if (row?.location && (row.location === siteNames.my || row.location === siteNames.pp)) {
    return row.location;
  }
  const phone = String(row?.phone_number || '');
  if (phone.startsWith('+855')) return siteNames.pp;
  return siteNames.my;
}

export const SIM_TOPUP_CYCLE_DAYS = 30;
export const SIM_TOPUP_CYCLE_OPTIONS = [30, 60, 90];

export function normalizeTopupCycleDays(value, fallback = SIM_TOPUP_CYCLE_DAYS) {
  const n = parseInt(value, 10);
  if (SIM_TOPUP_CYCLE_OPTIONS.includes(n)) return n;
  return fallback;
}

export function expiryFromChargeDate(chargeDate, cycleDays = SIM_TOPUP_CYCLE_DAYS) {
  const base = chargeDate ? new Date(`${chargeDate}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const days = normalizeTopupCycleDays(cycleDays, SIM_TOPUP_CYCLE_DAYS);
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Prefer DB expiry_date; else derive from last charge + cycle. */
export function resolveSimExpiryDate(row, ledger = {}) {
  const raw = row?.expiry_date || ledger.expiry_date || null;
  if (raw) {
    const iso = String(raw).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  const charged = row?.last_charged || ledger.last_charged;
  if (charged) {
    return expiryFromChargeDate(
      charged,
      normalizeTopupCycleDays(row?.last_cycle_days || ledger.last_cycle_days, SIM_TOPUP_CYCLE_DAYS),
    );
  }
  return null;
}

/** Days until expiry, or null when unknown (never fake 0). */
export function daysLeftFromExpiryDate(expiryIso) {
  if (!expiryIso) return null;
  const expiry = new Date(`${String(expiryIso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86400000));
}

export function formatDaysLeft(days) {
  if (days == null || !Number.isFinite(days)) return 'No expiry';
  if (days === 0) return 'Expired / due';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

export function daysLeftTagClass(days) {
  if (days == null || !Number.isFinite(days)) return 'due-none';
  if (days <= 3) return 'due-soon';
  if (days <= 7) return 'due-mid';
  return 'due-far';
}

export function formatTopupAmount(amount) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const SIM_LEDGER_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'stop_topup', label: 'Stop Top-up' },
];

export const SIM_EXCEPTION_REASONS = [
  { value: 'topup_failed', label: 'Top-up failed' },
  { value: 'number_suspended', label: 'Number suspended' },
  { value: 'account_ban_pending', label: 'Account banned (pending confirmation)' },
];

export function ledgerStatusLabel(status) {
  return SIM_LEDGER_STATUSES.find((s) => s.value === status)?.label || 'Active';
}

export function exceptionReasonLabel(reason) {
  return SIM_EXCEPTION_REASONS.find((r) => r.value === reason)?.label || reason || '—';
}
