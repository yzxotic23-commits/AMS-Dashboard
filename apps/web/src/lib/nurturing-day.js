const MS_DAY = 86_400_000;

/** SOP targets — auto may continue past day 7 (extended nurture / Trust Score). */
export const MANUAL_SOP_DAYS = 3;
export const AUTO_SOP_DAYS = 7;

/** Calendar nurturing day from start (1-based), no SOP cap. */
export function nurturingElapsedDay(startAt) {
  if (!startAt) return 1;
  const start = new Date(startAt);
  const elapsed = Math.floor((Date.now() - start.getTime()) / MS_DAY) + 1;
  return Math.max(1, elapsed);
}

/**
 * Display / logic day for a phase.
 * - manual: capped at SOP day 3 (scan-in gate)
 * - auto: uncapped so accounts past day 7 stay visible with accumulating days
 */
export function nurturingDay(startAt, phase = 'manual') {
  const elapsed = nurturingElapsedDay(startAt);
  if (phase === 'auto') return elapsed;
  return Math.min(MANUAL_SOP_DAYS, elapsed);
}

export function isManualScanDue(row) {
  return row.nurturing_phase === 'manual'
    && nurturingDay(row.nurturing_started_at, 'manual') >= MANUAL_SOP_DAYS;
}

/** Day ≥ SOP 7 — eligible for standby; graduation is manual (no auto-hide). */
export function isAutoGraduationDue(row) {
  return row.nurturing_phase === 'auto'
    && nurturingElapsedDay(row.nurturing_started_at) >= AUTO_SOP_DAYS;
}

export function nurturingProgress(startAt, phase = 'manual') {
  const max = phase === 'auto' ? AUTO_SOP_DAYS : MANUAL_SOP_DAYS;
  const day = nurturingDay(startAt, phase);
  return { day, max, remaining: Math.max(0, max - day) };
}
