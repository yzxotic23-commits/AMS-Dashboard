/** Normalize account hub owner label (from user management / registration). */
export function normalizeHubOwner(name) {
  return String(name || '').trim();
}

export function isHubOwner(name) {
  return Boolean(normalizeHubOwner(name));
}
