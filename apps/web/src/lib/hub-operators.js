/** Normalize account hub owner label (from user management / registration). */
export function normalizeHubOwner(name) {
  return String(name || '').trim();
}

export function rosterDisplayName(row) {
  return String(row?.full_name || row?.username || '').trim();
}

export function isHubOwner(name) {
  return Boolean(normalizeHubOwner(name));
}

function ownerKey(name) {
  return normalizeHubOwner(name).toLowerCase();
}

/** Match account owner label to a roster operator (full_name or username). */
export function ownerMatchesOperator(ownerLabel, operator) {
  const key = ownerKey(ownerLabel);
  if (!key) return false;
  const candidates = [operator?.full_name, operator?.username]
    .map(ownerKey)
    .filter(Boolean);
  return candidates.includes(key);
}

/** Map a raw owner string to the canonical roster display name when possible. */
export function canonicalHubOwner(rawOwner, roster = []) {
  const trimmed = normalizeHubOwner(rawOwner);
  if (!trimmed) return '';
  const match = roster.find((op) => ownerMatchesOperator(trimmed, op));
  return match ? rosterDisplayName(match) : trimmed;
}
