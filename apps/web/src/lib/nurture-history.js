import { MANUAL_SOP_DAYS } from './nurturing-day';

const MS_DAY = 86_400_000;

function toMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Inclusive day count (Day 1 on start — same clock as nurturing). */
export function spanDays(startAt, endAt) {
  const start = toMs(startAt);
  const end = toMs(endAt);
  if (start == null || end == null || end < start) return 1;
  return Math.max(1, Math.floor((end - start) / MS_DAY) + 1);
}

export function formatDayCount(days) {
  const n = Math.max(0, Number(days) || 0);
  if (n <= 0) return '';
  return n === 1 ? '1 day' : `${n} days`;
}

function sortedHistory(history = []) {
  return [...history].sort((a, b) => (toMs(a.changed_at) || 0) - (toMs(b.changed_at) || 0));
}

function isScanInReason(reason) {
  return /scan-in|system nurturing|moved to system/i.test(String(reason || ''));
}

/**
 * Nurturing path for Status History:
 * Manual nurturing → System nurturing → Standby, with day counts.
 */
export function buildNurtureTimeline(account, history = [], nowMs = Date.now()) {
  if (!account) return [];

  const rows = sortedHistory(history);
  const activated = [...rows].reverse().find(
    (h) => h.to_status === 'NURTURING' && h.from_status !== 'NURTURING',
  );
  const scanIn = rows.find((h) => isScanInReason(h.reason)
    || (h.from_status === 'NURTURING' && h.to_status === 'NURTURING' && /auto|system/i.test(h.reason || '')));
  const graduated = rows.find((h) => h.from_status === 'NURTURING' && h.to_status === 'AVAILABLE');

  const startMs = toMs(activated?.changed_at)
    || toMs(account.nurturing_started_at)
    || toMs(account.created_at);
  if (startMs == null) return [];

  const phase = account.nurturing_phase;
  const status = account.status;
  if (status === 'REGISTERING' || !status) return [];
  const pastNurture = Boolean(status && status !== 'NURTURING' && status !== 'REGISTERING');
  const endMs = toMs(graduated?.changed_at)
    || (status === 'NURTURING' ? nowMs : toMs(account.updated_at) || nowMs);

  const totalDays = spanDays(new Date(startMs).toISOString(), new Date(endMs).toISOString());
  const reachedSystem = phase === 'auto' || pastNurture || Boolean(scanIn) || Boolean(graduated);
  const manualDays = reachedSystem ? Math.min(MANUAL_SOP_DAYS, totalDays) : totalDays;
  const autoDays = reachedSystem ? Math.max(0, totalDays - manualDays) : 0;

  const scanMs = toMs(scanIn?.changed_at)
    || (reachedSystem ? startMs + (manualDays - 1) * MS_DAY : null);

  const startIso = new Date(startMs).toISOString();
  const steps = [];

  steps.push({
    key: 'manual',
    title: 'Manual nurturing',
    duration: formatDayCount(manualDays),
    from: startIso,
    to: scanMs != null ? new Date(scanMs).toISOString() : new Date(endMs).toISOString(),
    ongoing: phase === 'manual' && status === 'NURTURING',
    note: phase === 'manual' && status === 'NURTURING' ? 'in progress' : 'until scan-in',
  });

  if (reachedSystem) {
    steps.push({
      key: 'auto',
      title: 'System nurturing',
      duration: formatDayCount(autoDays) || (status === 'NURTURING' ? 'started' : formatDayCount(1)),
      from: scanMs != null ? new Date(scanMs).toISOString() : startIso,
      to: new Date(endMs).toISOString(),
      ongoing: phase === 'auto' && status === 'NURTURING',
      note: graduated ? 'until Standby' : (status === 'NURTURING' ? 'in progress' : null),
    });
  }

  if (graduated || status === 'AVAILABLE') {
    steps.push({
      key: 'standby',
      title: 'Standby',
      duration: null,
      from: graduated?.changed_at || new Date(endMs).toISOString(),
      to: null,
      ongoing: status === 'AVAILABLE',
      note: 'nurturing complete',
    });
  }

  return steps;
}

/**
 * Full ledger path: Manual → System → Standby (how long) → In Use (delivery ticket / business scan).
 */
export function buildAccountPath(account, history = [], tickets = [], nowMs = Date.now()) {
  const steps = buildNurtureTimeline(account, history, nowMs);
  const rows = sortedHistory(history);
  const ticket = latestDeliveryTicket(tickets);
  const graduated = rows.find((h) => h.from_status === 'NURTURING' && h.to_status === 'AVAILABLE')
    || rows.find((h) => h.to_status === 'AVAILABLE');
  const inUseEv = [...rows].reverse().find((h) => h.to_status === 'IN_USE');
  const ticketSubmittedEv = rows.find((h) => /delivery ticket/i.test(h.reason || '') && /submitted/i.test(h.reason || ''));

  const standbyStart = toMs(graduated?.changed_at);
  const inUseAt = toMs(inUseEv?.changed_at) || toMs(ticket?.in_progress_at);
  const ticketAt = toMs(ticket?.submitted_at || ticket?.created_at) || toMs(ticketSubmittedEv?.changed_at);
  const showStandby = standbyStart != null
    || account.status === 'AVAILABLE'
    || account.status === 'IN_USE'
    || Boolean(inUseAt)
    || Boolean(ticket);

  if (showStandby) {
    const startMs = standbyStart || toMs(account.nurturing_started_at) || toMs(account.created_at);
    if (startMs != null) {
      const endMs = inUseAt || (account.status === 'AVAILABLE' ? nowMs : toMs(account.updated_at) || nowMs);
      const ongoing = account.status === 'AVAILABLE' && !inUseAt;
      let note = 'waiting for delivery ticket';
      if (inUseAt) note = 'until In Use (delivery ticket / business scan)';
      else if (ticketAt) {
        note = ticket?.ticket_number
          ? `ticket #${ticket.ticket_number} submitted — awaiting go-live`
          : 'ticket submitted — awaiting go-live';
      }
      const standbyStep = {
        key: 'standby',
        title: 'Standby',
        duration: formatDayCount(spanDays(new Date(startMs).toISOString(), new Date(endMs).toISOString())),
        from: new Date(startMs).toISOString(),
        to: new Date(endMs).toISOString(),
        ongoing,
        note,
      };
      const idx = steps.findIndex((s) => s.key === 'standby');
      if (idx >= 0) steps[idx] = standbyStep;
      else steps.push(standbyStep);
    }
  }

  if (ticket || inUseAt || account.status === 'IN_USE') {
    const fromIso = new Date(inUseAt || ticketAt || nowMs).toISOString();
    steps.push({
      key: 'inuse',
      title: 'In Use',
      duration: null,
      from: fromIso,
      to: null,
      ongoing: account.status === 'IN_USE',
      note: ticket?.ticket_number
        ? `delivery ticket #${ticket.ticket_number} — business scan`
        : 'delivery ticket — business scan',
    });
  }

  return steps;
}

function latestDeliveryTicket(tickets = []) {
  const list = [...tickets].filter((t) => t && t.delivery_stage !== 'rejected');
  if (!list.length && tickets?.length) return tickets[0];
  list.sort((a, b) => (toMs(b.submitted_at || b.created_at) || 0) - (toMs(a.submitted_at || a.created_at) || 0));
  return list[0] || null;
}

export function historyRowCaption(h) {
  const reason = String(h.reason || '');
  if (isScanInReason(reason) || (h.from_status === 'NURTURING' && h.to_status === 'NURTURING')) {
    return { fromLabel: 'Manual nurturing', toLabel: 'System nurturing' };
  }
  if (h.to_status === 'NURTURING' && h.from_status && h.from_status !== 'NURTURING') {
    return { fromStatus: h.from_status, toLabel: 'Manual nurturing' };
  }
  if (h.from_status === 'NURTURING' && h.to_status === 'AVAILABLE') {
    return { fromLabel: 'Nurturing', toStatus: 'AVAILABLE' };
  }
  if (h.from_status === 'AVAILABLE' && h.to_status === 'IN_USE') {
    return { fromStatus: 'AVAILABLE', toStatus: 'IN_USE' };
  }
  if (h.from_status === 'IN_USE' && h.to_status === 'AVAILABLE') {
    return { fromStatus: 'IN_USE', toStatus: 'AVAILABLE' };
  }
  if (h.from_status === 'IN_USE' && h.to_status === 'IN_USE' && /Restricted/i.test(reason)) {
    const toLabel = /Restricted Chat/i.test(reason)
      ? 'Restricted Chat New Contact'
      : 'Restricted Scan';
    return { fromStatus: 'IN_USE', toLabel };
  }
  if (h.from_status === 'LOGGED_OUT' && h.to_status === 'IN_USE') {
    return { fromStatus: 'LOGGED_OUT', toStatus: 'IN_USE' };
  }
  if (h.from_status === 'LOGGED_OUT' && h.to_status === 'LOGGED_OUT' && /delivery ticket/i.test(reason)) {
    return { fromStatus: 'LOGGED_OUT', toLabel: 'Re-scan ticket' };
  }
  if (h.from_status === 'AVAILABLE' && h.to_status === 'AVAILABLE' && /delivery ticket/i.test(reason)) {
    return { fromStatus: 'AVAILABLE', toLabel: 'Delivery ticket' };
  }
  return { fromStatus: h.from_status, toStatus: h.to_status };
}
