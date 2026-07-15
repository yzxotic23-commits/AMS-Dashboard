/** Resolve FeedFlow engine slot for an AMS account row (slot first, then phone). */
export function findEngineSlotForAccount(account, slots = []) {
  if (!Array.isArray(slots) || !slots.length || !account) return null;

  if (account.wsaf_slot != null) {
    const bySlot = slots.find((s) => Number(s.slot) === Number(account.wsaf_slot));
    if (bySlot) return bySlot;
  }

  const ph = String(account.phone_number || '').replace(/\D/g, '');
  if (!ph) return null;
  return slots.find((s) => {
    const sp = String(s.phone || '').replace(/\D/g, '');
    return sp && ph.endsWith(sp.slice(-9));
  }) || null;
}

/**
 * Live connection from engine slot — not a Feeding audit status.
 * @returns {'online'|'offline'|null}
 */
export function liveSlotConnection(account, slots = []) {
  const slot = findEngineSlotForAccount(account, slots);
  if (!slot) return null;
  return slot.connected ? 'online' : 'offline';
}

/** Match AMS account to an offline engine slot row (for health sync). */
export function matchAccountForEngineSlot(accounts, slot) {
  if (!Array.isArray(accounts) || slot == null) return null;
  const slotNum = Number(slot.slot);

  const bySlot = accounts.find(
    (a) => a.wsaf_slot != null && Number(a.wsaf_slot) === slotNum,
  );
  if (bySlot) return bySlot;

  const phone = String(slot.phone || '').replace(/\D/g, '');
  if (!phone) return null;
  return accounts.find((a) => {
    if (a.wsaf_slot != null) return false;
    const acctPhone = String(a.phone_number || '').replace(/\D/g, '');
    return acctPhone && acctPhone.endsWith(phone.slice(-9));
  }) || null;
}
