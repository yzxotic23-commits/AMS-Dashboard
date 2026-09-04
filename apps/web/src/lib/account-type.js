/** Account access type: personal (Brand→Staff) vs brand_shared (Brand only). */

export const ACCOUNT_TYPE_PERSONAL = 'personal';
export const ACCOUNT_TYPE_BRAND_SHARED = 'brand_shared';
export const SHARED_SESSION_CAP = 4;

export function normalizeAccountType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === ACCOUNT_TYPE_BRAND_SHARED || v === 'shared') return ACCOUNT_TYPE_BRAND_SHARED;
  return ACCOUNT_TYPE_PERSONAL;
}

export function isBrandSharedAccount(accountOrRow) {
  if (!accountOrRow) return false;
  return normalizeAccountType(accountOrRow.account_type) === ACCOUNT_TYPE_BRAND_SHARED;
}

export function accountTypeLabel(type) {
  return normalizeAccountType(type) === ACCOUNT_TYPE_BRAND_SHARED
    ? 'Brand-wide / Shared'
    : 'Personal';
}
