/** Map DB account_status → operator-facing labels (Stage A ledger). */

export const STATUS_DISPLAY = {
  REGISTERING: { label: 'Registering', pill: 'badge-accent', filter: 'registering' },
  NURTURING: { label: 'Nurturing', pill: 'badge-warn', filter: 'nurturing' },
  AVAILABLE: { label: 'Standby', pill: 'badge-success', filter: 'standby' },
  IN_USE: { label: 'In Use', pill: 'badge-accent', filter: 'inuse' },
  LOGGED_OUT: { label: 'Logged out', pill: 'badge-default', filter: 'loggedout' },
  BANNED: { label: 'Banned', pill: 'badge-danger', filter: 'banned' },
  RECOVERING: { label: 'Recovering', pill: 'badge-warn', filter: 'recovering' },
  RECYCLED: { label: 'Recycled', pill: 'badge-default', filter: 'recycled' },
};

export function statusMeta(status) {
  return STATUS_DISPLAY[status] || { label: status || '—', pill: 'badge-default', filter: '' };
}

export function inferBrand(accountName) {
  const m = String(accountName || '').match(/^(SBMY|JMMY|STMY|PP)/i);
  return m ? m[1].toUpperCase() : '';
}

/** Infer trading brand from device shelf code (MYR-SB-001 → SBMY). */
export function inferBrandFromDevice(deviceName) {
  const name = String(deviceName || '').toUpperCase();
  if (name.includes('-SB') || name.includes('SB-')) return 'SBMY';
  if (name.includes('-JM') || name.includes('JM-')) return 'JMMY';
  if (name.includes('-ST') || name.includes('ST-')) return 'STMY';
  if (name.startsWith('PP')) return 'STMY';
  return '';
}

export function resolveAccountBrand(account) {
  if (!account) return '';
  if (account.brand) return account.brand;
  return inferBrand(account.account_name)
    || inferBrandFromDevice(account.device)
    || '';
}

export const BRAND_OPTIONS = ['SBMY', 'JMMY', 'STMY', 'PP'];
