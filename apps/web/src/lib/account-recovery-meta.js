/** Recovery workflow fields stored in accounts.notes. */

const REC_PREFIX = '_ams_rec:';

function parsePrefixedJsonBlock(notes, prefix) {
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

export function parseRecoveryMeta(account) {
  return parsePrefixedJsonBlock(account?.notes, REC_PREFIX);
}

export function serializeRecoveryNotes(existingNotes, recoveryMeta) {
  const notes = existingNotes || '';
  const without = notes.replace(new RegExp(`${REC_PREFIX}[\\s\\S]*$`), '').trim();
  const payload = `${REC_PREFIX}${JSON.stringify(recoveryMeta)}`;
  return without ? `${without}\n${payload}` : payload;
}

export function recoveryOnBanDefaults(stage = 'manual', reason = '') {
  const now = new Date().toISOString();
  return {
    recovery_status: 'need',
    started_at: now,
    ban_stage: stage,
    ban_reason: reason,
    log: [{ st: 'need', time: now, by: 'System' }],
  };
}

export function appendRecoveryLog(meta, entry) {
  const log = [...(meta.log || []), entry];
  return { ...meta, log, recovery_status: entry.st };
}

export function banSourceLabel(reasonOrStage) {
  const text = String(reasonOrStage || '');
  if (text === 'manual' || text.includes('[manual]')) return 'Manual phase';
  if (text === 'auto' || text.includes('[auto]')) return 'Auto / engine';
  if (text.toLowerCase().includes('nurturing')) return 'Nurturing';
  return 'Banned';
}

export function recElapsed(log, currentSt) {
  if (!log?.length) return '—';
  const start = log.find((e) => e.st === 'need') || log[0];
  const end = log.find((e) => e.st === currentSt) || log[log.length - 1];
  if (!start?.time || !end?.time) return '—';
  const ms = new Date(end.time).getTime() - new Date(start.time).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
