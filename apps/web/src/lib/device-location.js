/** Physical shelf/slot — stored in devices.notes or static demo map. */

export const DEVICE_MAX_SLOTS = 2;

/** WhatsApp slots per device code (max 2: Normal + Business). */
export const DEVICE_CHANNEL_SLOTS = [
  'WS Normal',
  'WS Business',
];

const LEGACY_CHANNEL_ALIASES = {
  'WS Slot 1': 'WS Normal',
  'WS Slot 2': 'WS Business',
};

export function normalizeDeviceChannel(channel) {
  const c = String(channel || '').trim();
  return LEGACY_CHANNEL_ALIASES[c] || c;
}

export function displayDeviceChannel(channel) {
  return normalizeDeviceChannel(channel) || channel || '';
}

export function channelSlotIndex(channel) {
  const normalized = normalizeDeviceChannel(channel);
  const idx = DEVICE_CHANNEL_SLOTS.indexOf(normalized);
  if (idx !== -1) return idx;
  const m = normalized.match(/(\d+)/);
  return m ? Math.min(parseInt(m[1], 10) - 1, DEVICE_MAX_SLOTS - 1) : 99;
}

/** Group device accounts into the two WA slots; extras only when both slots are full. */
export function groupAccountsByDeviceSlots(accounts) {
  const sorted = [...(accounts || [])].sort((a, b) => {
    const da = channelSlotIndex(a.channel);
    const db = channelSlotIndex(b.channel);
    if (da !== db) return da - db;
    return String(a.account_name || '').localeCompare(String(b.account_name || ''));
  });

  const bySlot = new Map();
  const overflow = [];

  for (const account of sorted) {
    const slot = normalizeDeviceChannel(account.channel);
    if (DEVICE_CHANNEL_SLOTS.includes(slot) && !bySlot.has(slot)) {
      bySlot.set(slot, account);
      continue;
    }
    const open = DEVICE_CHANNEL_SLOTS.find((s) => !bySlot.has(s));
    if (open) {
      bySlot.set(open, account);
      continue;
    }
    overflow.push(account);
  }

  const slots = DEVICE_CHANNEL_SLOTS.map((slotLabel) => ({
    slotLabel,
    account: bySlot.get(slotLabel) || null,
  }));

  return { slots, overflow };
}

const META_PREFIX = '_ams_loc:';

const SHELF_BY_NAME = {
  'MYR-SB-001': 'Shelf A · Slot 1',
  'MYR-SB-002': 'Shelf A · Slot 2',
  'MYR-SB-003': 'Shelf A · Slot 3',
  'MYR-SB-005': 'Shelf A · Slot 5',
  'MYR-SB-006': 'Shelf A · Slot 6',
  'MYR-SB-007': 'Shelf A · Slot 7',
  'MYR-SB-008': 'Shelf A · Slot 8',
  'MYR-SB-009': 'Shelf A · Slot 9',
  'MYR-SB-011': 'Shelf A · Slot 11',
  'MYR-SB-013': 'Shelf A · Slot 13',
  'MYR-SB-016': 'Shelf A · Slot 16',
  'PP-SB-014': 'Shelf B · Slot 2',
  'PP-SB-015': 'Shelf B · Slot 5',
  'PP-SB-016': 'Shelf B · Slot 4',
  'PP-SB-018': 'Shelf B · Slot 6',
  'PP-SB-019': 'Shelf B · Slot 5',
  'PP-SB-022': 'Shelf B · Slot 7',
};

export function serializeDeviceLocation(shelf) {
  return `${META_PREFIX}${JSON.stringify({ shelf })}`;
}

export function parseDeviceLocation(notes) {
  const text = notes || '';
  const idx = text.indexOf(META_PREFIX);
  if (idx === -1) return {};
  try {
    return JSON.parse(text.slice(idx + META_PREFIX.length));
  } catch {
    return {};
  }
}

export function deviceShelf(device) {
  const meta = parseDeviceLocation(device?.notes);
  if (meta.shelf) return meta.shelf;
  return SHELF_BY_NAME[device?.device_name] || '—';
}

/** Dropdown label: MYR-SB-001 — Shelf A, Slot 1 */
export function formatDeviceOptionLabel(device) {
  const name = device?.device_name || '';
  if (!name) return '';
  const shelf = deviceShelf(device);
  if (shelf === '—') return name;
  return `${name} — ${shelf.replace(/\s*·\s*/g, ', ')}`;
}

export function deviceSlotAvailability(deviceId, accounts = []) {
  const taken = accounts.filter((a) => a.device_id === deviceId).length;
  return {
    taken,
    free: Math.max(0, DEVICE_MAX_SLOTS - taken),
  };
}

/** First device with a free WA slot, plus the first free channel on that device. */
export function pickDeviceAndSlot(devices = [], accounts = []) {
  const list = devices || [];
  const device = list.find((d) => deviceSlotAvailability(d.id, accounts).free > 0) || list[0] || null;
  const deviceId = device?.id || '';
  if (!deviceId) return { deviceId: '', slot: DEVICE_CHANNEL_SLOTS[0] };
  const taken = new Set(
    (accounts || [])
      .filter((a) => a.device_id === deviceId)
      .map((a) => normalizeDeviceChannel(a.channel)),
  );
  const slot = DEVICE_CHANNEL_SLOTS.find((s) => !taken.has(s)) || DEVICE_CHANNEL_SLOTS[0];
  return { deviceId, slot };
}

/** Register drawer option label — e.g. MYR-SB-039 · 0/2 */
export function formatDeviceRegisterOption(device, accounts = []) {
  const name = device?.device_name || '';
  if (!name) return '';
  const { taken } = deviceSlotAvailability(device.id, accounts);
  const seats = Math.min(taken, DEVICE_MAX_SLOTS);
  return `${name} · ${seats}/${DEVICE_MAX_SLOTS}`;
}

/** Sort MYR-SB-001 before MYR-SB-002 … MYR-SB-011 (wireframe ledger order). */
export function compareDeviceNames(a, b) {
  const parse = (name) => {
    const m = String(name || '').match(/^([A-Z]+)-([A-Z]+)-(\d+)$/i);
    if (!m) return { site: String(name || ''), brand: '', unit: 0, raw: true };
    return { site: m[1].toUpperCase(), brand: m[2].toUpperCase(), unit: parseInt(m[3], 10), raw: false };
  };
  const ka = parse(a?.device_name);
  const kb = parse(b?.device_name);
  if (ka.raw || kb.raw) {
    return String(a?.device_name || '').localeCompare(String(b?.device_name || ''), undefined, { numeric: true });
  }
  if (ka.site !== kb.site) return ka.site.localeCompare(kb.site);
  if (ka.brand !== kb.brand) return ka.brand.localeCompare(kb.brand);
  return ka.unit - kb.unit;
}
