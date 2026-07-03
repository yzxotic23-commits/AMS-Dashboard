/**
 * Device farm inventory for bootstrap / seed.
 * Naming: {SITE}-{BRAND}-{UNIT} — unit starts at 003 for every site.
 */
const DEVICE_UNIT_START = 3;
const INITIAL_DEVICE_COUNT = 5;

function bootstrapEntry(siteKey, unit) {
  const prefix = siteKey === 'pp' ? 'PP' : 'MYR';
  const serialTag = siteKey === 'pp' ? 'PP' : 'MY';
  const shelf = siteKey === 'pp' ? 'Shelf B' : 'Shelf A';
  const device_name = `${prefix}-SB-${String(unit).padStart(3, '0')}`;
  return {
    device_name,
    shelf: `${shelf} · Unit ${unit}`,
    serial_number: `SN-${serialTag}-${String(unit).padStart(3, '0')}`,
  };
}

function initialUnits() {
  return Array.from({ length: INITIAL_DEVICE_COUNT }, (_, i) => DEVICE_UNIT_START + i);
}

export const BOOTSTRAP_DEVICES = [
  ...initialUnits().map((unit) => bootstrapEntry('my', unit)),
  ...initialUnits().map((unit) => bootstrapEntry('pp', unit)),
];

export function deviceNotes(shelf) {
  return `_ams_loc:${JSON.stringify({ shelf })}`;
}
