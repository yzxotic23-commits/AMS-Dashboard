import { parseOperatorMeta } from './accountMeta.js';

export const DEVICE_MAX_SLOTS = 2;
export const DEVICE_CHANNEL_SLOTS = ['WS Normal', 'WS Business'];

const LEGACY_CHANNEL_ALIASES = {
  'WS Slot 1': 'WS Normal',
  'WS Slot 2': 'WS Business',
};

export function normalizeDeviceChannel(channel) {
  const c = String(channel || '').trim();
  return LEGACY_CHANNEL_ALIASES[c] || c;
}

export class DeviceSlotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeviceSlotError';
    this.status = 409;
  }
}

export async function assertDeviceSlotAvailable(supabase, {
  device_id,
  channel,
  account_id = null,
  notes = null,
}) {
  if (!device_id) return;

  const slot = normalizeDeviceChannel(channel || parseOperatorMeta({ notes }).channel);
  if (!slot) {
    throw new DeviceSlotError('WA channel is required when assigning a device (WS Normal or WS Business).');
  }
  if (!DEVICE_CHANNEL_SLOTS.includes(slot)) {
    throw new DeviceSlotError(`Invalid WA slot "${slot}". Each device supports only: ${DEVICE_CHANNEL_SLOTS.join(' + ')}.`);
  }

  const { data: rows, error } = await supabase
    .from('accounts')
    .select('id, notes')
    .eq('device_id', device_id);
  if (error) throw error;

  const others = (rows || []).filter((row) => row.id !== account_id);
  if (others.length >= DEVICE_MAX_SLOTS) {
    throw new DeviceSlotError('Device already has 2 accounts — max WS Normal + WS Business per device.');
  }

  const slotTaken = others.some((row) => normalizeDeviceChannel(parseOperatorMeta(row).channel) === slot);
  if (slotTaken) {
    throw new DeviceSlotError(`${slot} is already occupied on this device.`);
  }
}
