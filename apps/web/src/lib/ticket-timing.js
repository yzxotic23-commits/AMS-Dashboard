/** Compact duration for ticket waiting / process labels (e.g. 12m, 2h 5m, 1d 3h). */
export function formatDurationShort(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${Math.max(1, totalSec)}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) {
    return hours ? `${days}d ${hours}h` : `${days}d`;
  }
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Waiting (still submitted) or Process (after operator acted / closed).
 * @returns {{ label: 'Waiting'|'Process', text: string, ms: number } | null}
 */
export function ticketTimingInfo(ticket, nowMs = Date.now()) {
  if (!ticket) return null;
  const submittedRaw = ticket.submitted_at || ticket.created_at;
  if (!submittedRaw) return null;
  const submitted = new Date(submittedRaw).getTime();
  if (Number.isNaN(submitted)) return null;

  const stage = ticket.delivery_stage || 'submitted';
  const isPending = stage === 'submitted' && !ticket.reject_reason;

  if (isPending) {
    const ms = Math.max(0, nowMs - submitted);
    const text = formatDurationShort(ms);
    return text ? { label: 'Waiting', text, ms } : null;
  }

  const endRaw = ticket.closed_at || ticket.in_progress_at || ticket.updated_at;
  const end = endRaw ? new Date(endRaw).getTime() : nowMs;
  if (Number.isNaN(end)) return null;
  const ms = Math.max(0, end - submitted);
  const text = formatDurationShort(ms);
  return text ? { label: 'Process', text, ms } : null;
}
