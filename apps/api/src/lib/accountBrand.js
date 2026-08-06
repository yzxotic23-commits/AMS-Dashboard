import { parseOperatorMeta } from './accountMeta.js';

export const ACCOUNT_BRAND_OPTIONS = ['SBMY', 'JMMY', 'STMY', 'PP'];

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

/** Cost-attribution brand from account meta → name → device. */
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

export function normalizeBrands(input) {
  const allowed = new Set(ACCOUNT_BRAND_OPTIONS);
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const brand = String(raw || '').trim().toUpperCase();
    if (!brand || !allowed.has(brand) || seen.has(brand)) continue;
    seen.add(brand);
    out.push(brand);
  }
  return out;
}

/** Brands to enforce for this profile, or null = no brand filter. */
export function profileBrandScope(profile) {
  if (!profile || profile.role !== 'business') return null;
  return normalizeBrands(profile.brands);
}

export function accountInBrandScope(account, brandScope) {
  if (!brandScope) return true;
  if (!brandScope.length) return false;
  const brand = resolveAccountBrand(account);
  return Boolean(brand && brandScope.includes(brand));
}
