const REC_PREFIX = '_ams_rec:';

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

export function serializeRecoveryNotes(existingNotes, recoveryMeta) {
  const notes = existingNotes || '';
  const without = notes.replace(new RegExp(`${REC_PREFIX}[\\s\\S]*$`), '').trim();
  const payload = `${REC_PREFIX}${JSON.stringify(recoveryMeta)}`;
  return without ? `${without}\n${payload}` : payload;
}
