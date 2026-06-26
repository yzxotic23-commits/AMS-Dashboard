/** Ready IP pool rules — aligned with IP Ledger SOP (max 2 accounts per IP). */

export const IP_MAX_BINDINGS = 2;

export function buildIpBindings(accounts = []) {
  const map = {};
  accounts.forEach((a) => {
    if (!a.ip_id) return;
    if (!map[a.ip_id]) map[a.ip_id] = [];
    map[a.ip_id].push(a);
  });
  return map;
}

export function ipBindingCount(row, bindings = {}) {
  return bindings[row.id]?.length ?? row.in_use ?? 0;
}

export function isIpReady(row, bindings = {}) {
  const active = row.active || row.status === 'ACTIVE';
  if (!active) return false;
  if (row.status === 'FLAGGED' || (row.risk_count ?? 0) >= 8) return false;
  return ipBindingCount(row, bindings) < IP_MAX_BINDINGS;
}

/** Whether an IP can be assigned to accountId (excludes full slots unless already bound). */
export function isIpSelectableForAccount(ip, bindings, accountIpId) {
  if (!ip) return false;
  if (ip.id === accountIpId) return true;
  return isIpReady(ip, bindings);
}

export function proxyBindingSuffix(count, accountIpId, ipId) {
  if (ipId === accountIpId) return '';
  if (count >= IP_MAX_BINDINGS) return ` (${IP_MAX_BINDINGS}/${IP_MAX_BINDINGS} full)`;
  if (count === 1) return ' (1/2)';
  return '';
}
