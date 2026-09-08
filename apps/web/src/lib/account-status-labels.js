import { tradingBrandFromDeviceCode } from './device-code';

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
  const m = String(accountName || '').match(/^(SBMY|JMMY|STMY|PP|FWSG|WBSG|M24SG)\b/i);
  return m ? m[1].toUpperCase() : '';
}

/** Infer trading brand from device code middle (MYR-SB-001 → SBMY, SGD-FW-001 → FWSG). */
export function inferBrandFromDevice(deviceName) {
  return tradingBrandFromDeviceCode(deviceName);
}

function deviceNameFromAccount(account) {
  const joined = Array.isArray(account.devices) ? account.devices[0] : account.devices;
  return account.device
    || account.device_name
    || joined?.device_name
    || '';
}

export function resolveAccountBrand(account) {
  if (!account) return '';
  const deviceName = deviceNameFromAccount(account);
  // Device code is source of truth when bound — stored meta.brand goes stale after device moves.
  const fromDevice = inferBrandFromDevice(deviceName);
  if (fromDevice) return fromDevice;
  if (account.brand) return String(account.brand).trim().toUpperCase();
  return inferBrand(account.account_name) || '';
}

export const BRAND_OPTIONS = ['SBMY', 'JMMY', 'STMY', 'PP', 'FWSG', 'WBSG', 'M24SG'];
