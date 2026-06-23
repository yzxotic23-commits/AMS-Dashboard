/**
 * Wireframe-aligned device farm inventory for bootstrap / seed.
 * Naming: {SITE}-{BRAND}-{UNIT}
 *   MYR = Malaysia rack · PP = Poipet rack
 *   SB = SBMY · JM = JMMY · ST = STMY (brand channel on device)
 */
export const BOOTSTRAP_DEVICES = [
  { device_name: 'MYR-SB-001', shelf: 'Shelf A · Slot 1', serial_number: 'SN-MY-001' },
  { device_name: 'MYR-SB-002', shelf: 'Shelf A · Slot 2', serial_number: 'SN-MY-002' },
  { device_name: 'MYR-SB-003', shelf: 'Shelf A · Slot 3', serial_number: 'SN-MY-003' },
  { device_name: 'MYR-SB-005', shelf: 'Shelf A · Slot 5', serial_number: 'SN-MY-005' },
  { device_name: 'MYR-SB-006', shelf: 'Shelf A · Slot 6', serial_number: 'SN-MY-006' },
  { device_name: 'MYR-SB-008', shelf: 'Shelf A · Slot 8', serial_number: 'SN-MY-008' },
  { device_name: 'MYR-SB-009', shelf: 'Shelf A · Slot 9', serial_number: 'SN-MY-009' },
  { device_name: 'MYR-SB-011', shelf: 'Shelf A · Slot 11', serial_number: 'SN-MY-011' },
  { device_name: 'PP-SB-014', shelf: 'Shelf B · Slot 2', serial_number: 'SN-PP-014' },
  { device_name: 'PP-SB-015', shelf: 'Shelf B · Slot 5', serial_number: 'SN-PP-015' },
  { device_name: 'PP-SB-016', shelf: 'Shelf B · Slot 4', serial_number: 'SN-PP-016' },
  { device_name: 'PP-SB-018', shelf: 'Shelf B · Slot 6', serial_number: 'SN-PP-018' },
  { device_name: 'PP-SB-019', shelf: 'Shelf B · Slot 3', serial_number: 'SN-PP-019' },
  { device_name: 'PP-SB-022', shelf: 'Shelf B · Slot 7', serial_number: 'SN-PP-022', status: 'MAINTENANCE' },
];

export function deviceNotes(shelf) {
  return `_ams_loc:${JSON.stringify({ shelf })}`;
}
