const MS_DAY = 86_400_000;

export function nurturingDay(startAt, phase = 'manual') {
  if (!startAt) return 1;
  const start = new Date(startAt);
  const elapsed = Math.floor((Date.now() - start.getTime()) / MS_DAY) + 1;
  const cap = phase === 'auto' ? 7 : 3;
  return Math.min(cap, Math.max(1, elapsed));
}

export function isManualScanDue(row) {
  return row.nurturing_phase === 'manual' && nurturingDay(row.nurturing_started_at, 'manual') >= 3;
}

export function isAutoGraduationDue(row) {
  return row.nurturing_phase === 'auto' && nurturingDay(row.nurturing_started_at, 'auto') >= 7;
}

export function nurturingProgress(startAt, phase = 'manual') {
  const max = phase === 'auto' ? 7 : 3;
  const day = nurturingDay(startAt, phase);
  return { day, max, remaining: Math.max(0, max - day) };
}
