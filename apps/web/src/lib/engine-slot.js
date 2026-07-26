/** Statuses that still occupy a FeedFlow engine slot. Standby/banned/etc. must free it. */
const SLOT_HOLDING_STATUSES = new Set(['NURTURING', 'IN_USE']);

export function accountHoldsEngineSlot(account) {
  if (!account || account.wsaf_slot == null) return false;
  return SLOT_HOLDING_STATUSES.has(account.status);
}

/** Map wsaf_slot → account_name for slots still held by active nurturing / in-use accounts. */
export function buildSlotTakenByMap(accounts = [], excludeAccountId = null) {
  const map = {};
  for (const a of accounts) {
    if (!accountHoldsEngineSlot(a)) continue;
    if (excludeAccountId && a.id === excludeAccountId) continue;
    map[a.wsaf_slot] = a.account_name;
  }
  return map;
}

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
  // Treat saved session as online — matches FeedFlow UI when preview reconnect is off.
  return (slot.connected || slot.authSaved) ? 'online' : 'offline';
}

/** Match AMS account to an offline engine slot row (for health sync). */
export function matchAccountForEngineSlot(accounts, slot) {
  if (!Array.isArray(accounts) || slot == null) return null;
  const slotNum = Number(slot.slot);

  const bySlot = accounts.find(
    (a) => a.wsaf_slot != null && Number(a.wsaf_slot) === slotNum && accountHoldsEngineSlot(a),
  );
  if (bySlot) return bySlot;

  // Fallback: any account still pointing at slot (legacy sticky standby) for logout sync.
  const sticky = accounts.find(
    (a) => a.wsaf_slot != null && Number(a.wsaf_slot) === slotNum,
  );
  if (sticky) return sticky;

  const phone = String(slot.phone || '').replace(/\D/g, '');
  if (!phone) return null;
  return accounts.find((a) => {
    if (a.wsaf_slot != null) return false;
    const acctPhone = String(a.phone_number || '').replace(/\D/g, '');
    return acctPhone && acctPhone.endsWith(phone.slice(-9));
  }) || null;
}
