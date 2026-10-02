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

/** Recovery queue entry for an account blocked by its SIM (not a platform ban). */
export function recoveryOnSimAnomalyDefaults(simReason, label) {
  const now = new Date().toISOString();
  return {
    recovery_status: 'need',
    started_at: now,
    cause: 'sim_anomaly',
    sim_reason: simReason,
    ban_stage: null,
    ban_reason: `SIM Card Anomaly — ${label}`,
    log: [{ st: 'need', time: now, by: 'System', reason: `SIM Card Anomaly — ${label}` }],
  };
}

export function serializeRecoveryNotes(existingNotes, recoveryMeta) {
  const notes = existingNotes || '';
  const without = notes.replace(new RegExp(`${REC_PREFIX}[\\s\\S]*$`), '').trim();
  const payload = `${REC_PREFIX}${JSON.stringify(recoveryMeta)}`;
  return without ? `${without}\n${payload}` : payload;
}
