/** Device farm codes — {PREFIX}-{MIDDLE}-{UNIT}, unit starts at 003 per site. */

export const DEVICE_UNIT_START = 3;
export const DEVICE_AUTO_EXPAND_COUNT = 5;
export const DEVICE_MAX_WA_SLOTS = 2;
const META_PREFIX = '_ams_loc:';

/** Middle segment of device code → AMS trading brand. */
export const DEVICE_MIDDLE_TO_BRAND = {
  SB: 'SBMY',
  JM: 'JMMY',
  ST: 'STMY',
  FW: 'FWSG',
  WB: 'WBSG',
  M24: 'M24SG',
};

export function siteDevicePrefix(siteKey) {
  return siteKey === 'pp' ? 'PP' : 'MYR';
}

export function parseDeviceCode(deviceName) {
  const m = String(deviceName || '').match(/^([A-Z]+)-([A-Z0-9]+)-(\d+)$/i);
  if (!m) return null;
  return {
    sitePrefix: m[1].toUpperCase(),
    brand: m[2].toUpperCase(),
    unit: parseInt(m[3], 10),
  };
}

/** Trading brand from device code middle segment (SGD-FW-001 → FWSG). */
export function tradingBrandFromDeviceCode(deviceName) {
  const parsed = parseDeviceCode(deviceName);
  if (parsed) {
    const mapped = DEVICE_MIDDLE_TO_BRAND[parsed.brand];
    if (mapped) return mapped;
  }
  const name = String(deviceName || '').toUpperCase();
  if (name.startsWith('PP-') || name === 'PP') return 'STMY';
  return '';
}

export function formatDeviceCode(siteKey, unit, brand = 'SB') {
  const sitePrefix = siteDevicePrefix(siteKey);
  return `${sitePrefix}-${brand}-${String(unit).padStart(3, '0')}`;
}

export function deviceNotesForUnit(siteKey, unit) {
  const shelf = siteKey === 'pp' ? 'Shelf B' : 'Shelf A';
  return `${META_PREFIX}${JSON.stringify({ shelf: `${shelf} · Unit ${unit}` })}`;
}

export function deviceMatchesSite(deviceName, siteKey, storedSiteKey = null) {
  if (storedSiteKey === 'my' || storedSiteKey === 'pp') {
    return storedSiteKey === siteKey;
  }
  const parsed = parseDeviceCode(deviceName);
  if (!parsed) return siteKey !== 'pp';
  // Legacy SGD without site_key: still usable on both MY + PP
  if (parsed.sitePrefix === 'SGD') return siteKey === 'my' || siteKey === 'pp';
  if (siteKey === 'pp') return parsed.sitePrefix === 'PP';
  return parsed.sitePrefix === 'MYR';
}

export function slotsUsedOnDevice(deviceId, accounts = []) {
  return accounts.filter(
    (a) => a.device_id === deviceId && a.status !== 'RECYCLED',
  ).length;
}

export function siteDevicesForCapacity(devices, siteKey) {
  return (devices || []).filter(
    (d) => d.status === 'ACTIVE' && deviceMatchesSite(d.device_name, siteKey, d.site_key),
  );
}

export function siteHasFreeWaSlot(devices, accounts, siteKey) {
  const siteDevices = siteDevicesForCapacity(devices, siteKey);
  if (siteDevices.length === 0) return false;
  return siteDevices.some(
    (d) => slotsUsedOnDevice(d.id, accounts) < DEVICE_MAX_WA_SLOTS,
  );
}

export function maxDeviceUnit(devices, siteKey) {
  const want = siteDevicePrefix(siteKey);
  let max = DEVICE_UNIT_START - 1;
  for (const d of devices || []) {
    const parsed = parseDeviceCode(d.device_name);
    if (!parsed || parsed.sitePrefix !== want) continue;
    if (parsed.unit > max) max = parsed.unit;
  }
  return max;
}

export function nextDeviceCodes(siteKey, devices, count = DEVICE_AUTO_EXPAND_COUNT) {
  const existing = new Set(
    (devices || [])
      .map((d) => d.device_name)
      .filter((name) => deviceMatchesSite(name, siteKey)),
  );
  const codes = [];
  let unit = Math.max(maxDeviceUnit(devices, siteKey), DEVICE_UNIT_START - 1);
  while (codes.length < count) {
    unit += 1;
    const name = formatDeviceCode(siteKey, unit);
    if (existing.has(name)) continue;
    codes.push({ unit, device_name: name });
  }
  return codes;
}

export async function ensureDeviceCapacity(supabase, siteKey) {
  if (siteKey !== 'my' && siteKey !== 'pp') {
    return { expanded: false, created: [] };
  }

  const [{ data: devices, error: devErr }, { data: accounts, error: accErr }] = await Promise.all([
    supabase.from('devices').select('id, device_name, status, serial_number, site_key').limit(500),
    supabase.from('accounts').select('id, device_id, status').limit(1000),
  ]);
  if (devErr) throw devErr;
  if (accErr) throw accErr;

  if (siteHasFreeWaSlot(devices || [], accounts || [], siteKey)) {
    return { expanded: false, created: [] };
  }

  const planned = nextDeviceCodes(siteKey, devices || []);
  const created = [];
  const serialTag = siteKey === 'pp' ? 'PP' : 'MY';
  const usedSerials = new Set(
    (devices || []).map((d) => d.serial_number).filter(Boolean),
  );

  for (const row of planned) {
    const serial = `SN-${serialTag}-${String(row.unit).padStart(3, '0')}`;
    const payload = {
      device_name: row.device_name,
      brand: 'Samsung',
      model: 'A14',
      serial_number: usedSerials.has(serial) ? null : serial,
      status: 'ACTIVE',
      site_key: siteKey,
      notes: deviceNotesForUnit(siteKey, row.unit),
    };
    const { data, error } = await supabase.from('devices').insert(payload).select().single();
    if (error) throw error;
    if (payload.serial_number) usedSerials.add(payload.serial_number);
    created.push(data);
  }

  return {
    expanded: true,
    created: created.map((d) => d.device_name),
    message: `Added ${created.length} devices (${created[0]?.device_name}–${created[created.length - 1]?.device_name})`,
  };
}
