/** Parse operator meta from accounts.notes — server-side copy. */
const META_PREFIX = '_ams_op:';

export function parseOperatorMeta(account) {
  const notes = account?.notes || '';
  const idx = notes.indexOf(META_PREFIX);
  if (idx === -1) return {};
  try {
    return JSON.parse(notes.slice(idx + META_PREFIX.length));
  } catch {
    return {};
  }
}
