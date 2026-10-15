/** Role-based page access for AMS web shell. */

export const BUSINESS_NAV_PATHS = ['/tickets', '/governance', '/accounts'];

export function homePathForRole(role) {
  return role === 'business' ? '/tickets' : '/';
}

export function isPathAllowedForRole(pathname, role) {
  if (role !== 'business') return true;
  const path = String(pathname || '');
  return BUSINESS_NAV_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}
