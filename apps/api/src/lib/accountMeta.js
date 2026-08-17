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

/** Write human note + `_ams_op:{...}` meta into accounts.notes. */
export function serializeAccountNotes(meta = {}, humanNote = '') {
  const clean = String(humanNote || '')
    .replace(new RegExp(`${META_PREFIX}[\\s\\S]*$`), '')
    .trim();
  const payload = `${META_PREFIX}${JSON.stringify(meta)}`;
  return clean ? `${clean}\n${payload}` : payload;
}

/** Merge patch fields into existing operator meta and rebuild notes. */
export function mergeOperatorNotes(currentNotes, metaPatch = {}, humanNote) {
  const prev = parseOperatorMeta({ notes: currentNotes });
  const next = { ...prev, ...metaPatch };
  const note = humanNote !== undefined ? humanNote : (next.human_note || '');
  if (humanNote !== undefined) next.human_note = humanNote;
  ['restrict_kind', 'disconnect_report', 'business_notice'].forEach((key) => {
    if (next[key] == null) delete next[key];
  });
  return serializeAccountNotes(next, note);
}
