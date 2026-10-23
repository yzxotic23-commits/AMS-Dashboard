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

/** Ledger already knows this account left WhatsApp — do not trust a leftover engine socket. */
export function accountLooksDisconnected(account) {
  if (!account) return false;
  if (account.status === 'LOGGED_OUT' || account.status === 'BANNED') return true;
  return Boolean(account.disconnect_report);
}

/** Live WA socket only. Saved auth / leftover preview session is not Online. */
export function isLiveEngineSlot(slot) {
  if (!slot || slot.loggingOut || slot.loggedOut) return false;
  if (slot.feedingActive) return true;
  return Boolean(slot.connected);
}

/**
 * Live connection from engine slot — not a Feeding audit status.
 * Online = live/connected socket only. authSaved alone is NOT online (stale session
 * after Restricted/logout was incorrectly keeping AMS on Online).
 * @returns {'online'|'offline'|null}
 */
export function liveSlotConnection(account, slots = []) {
  if (accountLooksDisconnected(account)) return 'offline';
  const slot = findEngineSlotForAccount(account, slots);
  if (!slot) return null;
  return isLiveEngineSlot(slot) ? 'online' : 'offline';
}

/** FeedFlow Current Status Live pill — live session first, ledger is only a fallback. */
export function slotLiveLabel(slot, account) {
  if (!slot) {
    if (accountLooksDisconnected(account)) {
      return account?.disconnect_report ? 'Pending confirm' : 'Offline';
    }
    return 'Offline';
  }
  if (slot.feedingActive && !slot.loggedOut) return 'Feeding';
  if (slot.linking) return 'Linking';
  if (slot.loggedOut) return 'Offline';
  if (isLiveEngineSlot(slot)) return 'Online';
  if (accountLooksDisconnected(account)) {
    return account?.disconnect_report ? 'Pending confirm' : 'Offline';
  }
  if (slot.authSaved) return 'Session saved';
  return 'Offline';
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
