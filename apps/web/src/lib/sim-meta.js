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
  const { prepared, human } = parseSimNotesMeta(row?.notes);
  if (human) return human;
  if (prepared.site_key && siteNames[prepared.site_key]) return siteNames[prepared.site_key];
  if (row?.location) return row.location;
  const phone = String(row?.phone_number || '');
  if (phone.startsWith('+855')) return siteNames.pp;
  return siteNames.my;
}

export const SIM_TOPUP_CYCLE_DAYS = 30;

export function expiryFromChargeDate(chargeDate, cycleDays = SIM_TOPUP_CYCLE_DAYS) {
  const base = chargeDate ? new Date(`${chargeDate}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + cycleDays);
  return base.toISOString().slice(0, 10);
}
