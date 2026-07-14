/** Parse operator meta from accounts.notes — server-side copy. */
const META_PREFIX = '_ams_op:';

/** Parse one `_ams_*:{...}` JSON block; stops before the next `_ams_` marker. */
export function parsePrefixedJsonBlock(notes, prefix) {
  const text = String(notes || '');
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;
  const raw = text.slice(idx + prefix.length);
  const next = raw.search(/\n_ams_/);
  const jsonStr = (next === -1 ? raw : raw.slice(0, next)).trim();
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export function parseOperatorMeta(account) {
  return parsePrefixedJsonBlock(account?.notes, META_PREFIX) || {};
}
