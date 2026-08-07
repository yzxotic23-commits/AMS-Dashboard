/** Device farm codes — {PREFIX}-{MIDDLE}-{UNIT}. Middle maps to trading brand. */

export const DEVICE_MIDDLE_TO_BRAND = {
  SB: 'SBMY',
  JM: 'JMMY',
  ST: 'STMY',
  FW: 'FWSG',
  WB: 'WBSG',
  M24: 'M24SG',
};

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

export function isDeviceCodePattern(deviceName) {
  return Boolean(parseDeviceCode(deviceName));
}
