import { parseOperatorMeta } from './accountMeta.js';

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Staff labels for this profile, or null = no staff filter (operator/admin). */
export function profileStaffScope(profile) {
  if (!profile || profile.role !== 'business') return null;
  const names = [profile.full_name, profile.username]
    .map(norm)
    .filter(Boolean);
  return [...new Set(names)];
}

export function accountStaffName(account) {
  if (!account) return '';
  if (account.staff) return String(account.staff).trim();
  return String(parseOperatorMeta(account).staff || '').trim();
}

export function accountInStaffScope(account, staffScope) {
  if (!staffScope) return true;
  if (!staffScope.length) return false;
  const staff = norm(accountStaffName(account));
  return Boolean(staff && staffScope.includes(staff));
}
