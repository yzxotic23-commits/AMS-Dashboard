/** Ready IP pool rules — aligned with IP Ledger SOP (max 2 accounts per IP). */

export function ipBindingCount(row, bindings = {}) {
  return bindings[row.id]?.length ?? row.in_use ?? 0;
}

export function isIpReady(row, bindings = {}) {
  const active = row.active || row.status === 'ACTIVE';
  if (!active) return false;
  if (row.status === 'FLAGGED' || (row.risk_count ?? 0) >= 8) return false;
  return ipBindingCount(row, bindings) < 2;
}
