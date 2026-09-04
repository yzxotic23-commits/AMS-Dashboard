/** Staff labels for this profile, or null = no staff filter (operator/admin). */
import { isBrandSharedAccount } from './account-type';

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function profileStaffScope(profile) {
  if (!profile || profile.role !== 'business') return null;
  const names = [profile.full_name, profile.username]
    .map(norm)
    .filter(Boolean);
  return [...new Set(names)];
}

/**
 * Business visibility by Staff assignment.
 * Brand-shared accounts skip Staff match (Brand ACL applied separately).
 */
export function accountInStaffScope(account, staffScope) {
  if (!staffScope) return true;
  if (!staffScope.length) return false;
  if (isBrandSharedAccount(account)) return true;
  const staff = norm(account?.staff);
  return Boolean(staff && staffScope.includes(staff));
}
