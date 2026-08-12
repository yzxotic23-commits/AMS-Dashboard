import { parseOperatorMeta } from './accountMeta.js';
import { tradingBrandFromDeviceCode } from './deviceCapacity.js';

export const ACCOUNT_BRAND_OPTIONS = [
  'SBMY', 'JMMY', 'STMY', 'PP', 'FWSG', 'WBSG', 'M24SG',
];

const NAME_BRAND_RE = /^(SBMY|JMMY|STMY|PP|FWSG|WBSG|M24SG)\b/i;

function inferBrandFromName(accountName) {
  const m = String(accountName || '').match(NAME_BRAND_RE);
  return m ? m[1].toUpperCase() : '';
}

/** Cost-attribution brand: device code first (stays in sync with Device Ledger), then meta/name. */
export function resolveAccountBrand(account) {
  if (!account) return '';
  const deviceName = account.device_name
    || account.devices?.device_name
    || account.device?.device_name
    || '';
  const fromDevice = tradingBrandFromDeviceCode(deviceName);
  if (fromDevice) return fromDevice;
  const meta = parseOperatorMeta(account);
  if (meta.brand) return String(meta.brand).trim().toUpperCase();
  return inferBrandFromName(account.account_name) || '';
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
