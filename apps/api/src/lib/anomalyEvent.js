/** Keep-alive logout → pending confirmation (ban-data spec V1). */

export const ANOMALY_PENDING = 'pending';
export const ANOMALY_RESTRICT = 'restrict';
export const ANOMALY_BANNED = 'banned';
export const ANOMALY_FALSE_POSITIVE = 'false_positive';
export const ANOMALY_LOGGED_OUT = 'logged_out';

const STAGE_LABEL = {
  manual_nurture: 'Manual Nurture',
  auto_nurture: 'Auto Nurture',
  in_use: 'In Use',
  other: 'Other',
};

export function occurrenceStage(status, meta = {}) {
  if (status === 'NURTURING') {
    return meta.nurturing_phase === 'auto' ? 'auto_nurture' : 'manual_nurture';
  }
  if (status === 'IN_USE') return 'in_use';
  if (status === 'LOGGED_OUT' && meta.nurturing_phase && meta.disconnect_report?.from_status === 'NURTURING') {
    return meta.nurturing_phase === 'auto' ? 'auto_nurture' : 'manual_nurture';
  }
  return 'other';
}

export function stageLabel(stage) {
  return STAGE_LABEL[stage] || STAGE_LABEL.other;
}

export function isPendingAnomaly(report) {
  if (!report) return false;
  const status = report.confirmation_status || ANOMALY_PENDING;
  return status === ANOMALY_PENDING;
}

export function eventLogoutAt(report) {
  return report?.logout_at || report?.reported_at || null;
}

/** Open or reuse a pending anomaly. Logout timestamp is frozen once set. */
export function openAnomalyEvent(meta = {}, fields = {}) {
  const existing = meta.disconnect_report;
  if (isPendingAnomaly(existing)) {
    return {
      disconnect_report: existing,
      disconnect_count: Number(existing.disconnect_count || meta.disconnect_count || 1),
    };
  }
  const logoutAt = fields.logoutAt || new Date().toISOString();
  const fromStatus = fields.fromStatus || 'IN_USE';
  const stage = fields.stage || occurrenceStage(fromStatus, meta);
  const count = Number(meta.disconnect_count || 0) + 1;
  const report = {
    confirmation_status: ANOMALY_PENDING,
    logout_at: logoutAt,
    reported_at: logoutAt,
    reported_by: fields.reportedBy || 'AMS Engine',
    note: fields.note || '',
    source: fields.source || 'engine_health',
    stage,
    from_status: fromStatus,
    disconnect_count: count,
    slot: fields.slot == null ? null : Number(fields.slot),
  };
  return { disconnect_report: report, disconnect_count: count };
}

/** Close pending report into history. logout_at is never overwritten. */
export function closeAnomalyEvent(meta = {}, fields = {}) {
  const report = meta.disconnect_report;
  if (!report) {
    return { disconnect_report: null, anomaly_history: meta.anomaly_history || [] };
  }
  const closed = {
    ...report,
    confirmation_status: fields.outcome,
    outcome: fields.outcome,
    reason: fields.reason || '',
    restrict_kind: fields.restrictKind || null,
    confirmed_at: new Date().toISOString(),
    logout_at: eventLogoutAt(report),
  };
  const history = [...(meta.anomaly_history || []), closed].slice(-50);
  return {
    disconnect_report: null,
    anomaly_history: history,
    last_anomaly: closed,
    disconnect_count: Number(closed.disconnect_count || meta.disconnect_count || 0),
  };
}

export function collectAnomalyEvents(meta = {}) {
  const closed = meta.anomaly_history || [];
  const pending = isPendingAnomaly(meta.disconnect_report) ? [meta.disconnect_report] : [];
  return [...closed, ...pending];
}

/** Close pending, or open+close so a direct Ban/Restrict still lands in KPI. */
export function finalizeAnomaly(meta = {}, fields = {}) {
  const fromStatus = fields.fromStatus
    || meta.disconnect_report?.from_status
    || 'IN_USE';
  let working = meta;
  if (!isPendingAnomaly(meta.disconnect_report)) {
    const opened = openAnomalyEvent(meta, {
      fromStatus,
      logoutAt: fields.logoutAt,
      note: fields.note || fields.reason || '',
      source: fields.source || 'manual',
      reportedBy: fields.reportedBy,
    });
    working = { ...meta, ...opened };
  }
  return closeAnomalyEvent(working, {
    outcome: fields.outcome,
    reason: fields.reason,
    restrictKind: fields.restrictKind,
  });
}

export function kpiOutcome(outcome) {
  if (outcome === 'restrict_scan' || outcome === 'restrict_chat_new' || outcome === 'restrict') {
    return ANOMALY_RESTRICT;
  }
  if (outcome === 'banned') return ANOMALY_BANNED;
  if (outcome === 'false_positive') return ANOMALY_FALSE_POSITIVE;
  if (outcome === 'logged_out') return ANOMALY_LOGGED_OUT;
  return outcome || ANOMALY_PENDING;
}

export function aggregateAnomalyKpis(accounts, { range, siteKey, inDateRange } = {}) {
  const stageOrder = ['manual_nurture', 'auto_nurture', 'in_use', 'other'];
  const empty = () => ({ banned: 0, restrict: 0, pending: 0, logged_out: 0, false_positive: 0 });
  const byStageMap = Object.fromEntries(stageOrder.map((s) => [s, empty()]));
  let pendingBacklog = 0;
  let bannedTotal = 0;
  let restrictTotal = 0;
  let logoutTotal = 0;
  let falsePositiveTotal = 0;

  for (const row of accounts || []) {
    const meta = row._meta || {};
    if (siteKey && siteKey !== 'all' && (meta.site_key || 'my') !== siteKey) continue;
    const events = collectAnomalyEvents(meta);
    for (const ev of events) {
      const when = eventLogoutAt(ev);
      if (range && inDateRange && !inDateRange(when, range)) continue;
      const stage = ev.stage || 'other';
      const bucket = byStageMap[stage] || byStageMap.other;
      const kpi = isPendingAnomaly(ev) ? ANOMALY_PENDING : kpiOutcome(ev.outcome || ev.confirmation_status);
      if (kpi === ANOMALY_PENDING) {
        bucket.pending += 1;
        pendingBacklog += 1;
      } else if (kpi === ANOMALY_BANNED) {
        bucket.banned += 1;
        bannedTotal += 1;
      } else if (kpi === ANOMALY_RESTRICT) {
        bucket.restrict += 1;
        restrictTotal += 1;
      } else if (kpi === ANOMALY_LOGGED_OUT) {
        bucket.logged_out += 1;
        logoutTotal += 1;
      } else if (kpi === ANOMALY_FALSE_POSITIVE) {
        bucket.false_positive += 1;
        falsePositiveTotal += 1;
      }
    }
  }

  const byStage = stageOrder.map((stage) => {
    const b = byStageMap[stage];
    const denom = b.banned + b.restrict + b.pending + b.logged_out + b.false_positive;
    return {
      name: stageLabel(stage),
      stage,
      ...b,
      count: b.banned,
      pct: denom > 0 ? Math.round((b.banned / denom) * 1000) / 10 : 0,
    };
  }).filter((s) => s.banned + s.restrict + s.pending + s.logged_out + s.false_positive > 0);

  return {
    pendingBacklog,
    bannedTotal,
    restrictTotal,
    logoutTotal,
    falsePositiveTotal,
    byStage,
  };
}
