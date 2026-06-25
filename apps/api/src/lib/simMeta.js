/** SIM notes metadata — prepared queue + ledger top-up fields. */

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

export function mapSimRow(sim, accountBySimId = new Map(), accountByCurrentId = new Map(), accountByPhoneDigits = new Map()) {
  const { ledger } = parseSimNotesMeta(sim.notes);
  const bound = resolveBoundAccount(sim, accountBySimId, accountByCurrentId, accountByPhoneDigits);
  const expiry = sim.expiry_date ? new Date(`${sim.expiry_date}T12:00:00`) : null;
  const daysLeft = expiry
    ? Math.max(0, Math.ceil((expiry - Date.now()) / 86400000))
    : 0;
  const site_key = inferSimSiteKey(sim);
  return {
    ...sim,
    account_name: bound?.account_name || null,
    last_charged: ledger.last_charged || null,
    days_left: daysLeft,
    site_key,
    site_name: simSiteName(site_key),
    location: simSiteName(site_key),
  };
}
