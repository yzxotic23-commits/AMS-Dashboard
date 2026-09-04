/** Account access type: personal (Brand→Staff) vs brand_shared (Brand only). */

import { parseOperatorMeta } from './accountMeta.js';

export const ACCOUNT_TYPE_PERSONAL = 'personal';
export const ACCOUNT_TYPE_BRAND_SHARED = 'brand_shared';
export const SHARED_SESSION_CAP = 4;

export function normalizeAccountType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === ACCOUNT_TYPE_BRAND_SHARED || v === 'shared') return ACCOUNT_TYPE_BRAND_SHARED;
  return ACCOUNT_TYPE_PERSONAL;
}

/** Resolve type from enriched row (`account_type`) or raw account notes. */
export function resolveAccountType(account) {
  if (!account) return ACCOUNT_TYPE_PERSONAL;
  if (account.account_type != null && account.account_type !== '') {
    return normalizeAccountType(account.account_type);
  }
  const meta = parseOperatorMeta(account);
  return normalizeAccountType(meta.account_type);
}

export function isBrandSharedAccount(account) {
  return resolveAccountType(account) === ACCOUNT_TYPE_BRAND_SHARED;
}

export function accountTypeLabel(type) {
  return normalizeAccountType(type) === ACCOUNT_TYPE_BRAND_SHARED
    ? 'Brand-wide / Shared'
    : 'Personal';
}
