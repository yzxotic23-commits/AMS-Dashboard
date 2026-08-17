const TKT_PREFIX = '_ams_tkt:';

export function parseTicketMeta(ticket) {
  const desc = ticket?.description || '';
  const idx = desc.indexOf(TKT_PREFIX);
  if (idx === -1) {
    return { delivery_stage: stageFromStatus(ticket?.status) };
  }
  try {
    const meta = JSON.parse(desc.slice(idx + TKT_PREFIX.length));
    return {
      ...meta,
      delivery_stage: meta.delivery_stage || stageFromStatus(ticket?.status),
    };
  } catch {
    return { delivery_stage: stageFromStatus(ticket?.status) };
  }
}

export function serializeTicketDescription(note, meta) {
  const base = (note || '').replace(new RegExp(`${TKT_PREFIX}[\\s\\S]*$`), '').trim();
  const payload = `${TKT_PREFIX}${JSON.stringify(meta)}`;
  return base ? `${base}\n${payload}` : payload;
}

export function stageFromStatus(status) {
  if (status === 'IN_PROGRESS') return 'posted';
  if (status === 'RESOLVED' || status === 'CLOSED') return 'done';
  return 'submitted';
}

export function statusFromStage(stage) {
  if (stage === 'posted') return 'IN_PROGRESS';
  if (stage === 'done') return 'RESOLVED';
  if (stage === 'rejected') return 'OPEN';
  return 'OPEN';
}

export function proxyFromIp(ipRow) {
  if (!ipRow) return null;
  return {
    ip_address: ipRow.ip_address || '',
    port: String(ipRow.port ?? ''),
    username: ipRow.username || '',
    password: ipRow.password || '',
  };
}

export function proxyMatch(bind, shot) {
  if (!bind || !shot) return false;
  return (
    bind.ip_address === shot.ip_address
    && String(bind.port) === String(shot.port)
    && bind.username === shot.username
    && bind.password === shot.password
  );
}

const PLACEHOLDER_REJECT = /^(fail|failed|rejected|error|mismatch|false|true)$/i;
const IP_MISMATCH_REASON = 'IP mismatch — proxy screenshot does not match bound IP';
const GENERIC_REJECT_REASON = 'Rejected during IP review — resubmit with a corrected screenshot';

export function isPlaceholderRejectReason(value) {
  const text = String(value || '').trim();
  return !text || PLACEHOLDER_REJECT.test(text);
}

export function resolveRejectReason(ticketOrMeta = {}) {
  const candidates = [
    ticketOrMeta.reject_reason,
    ticketOrMeta.reason,
    ticketOrMeta.review_note,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (!isPlaceholderRejectReason(text)) return text;
  }
  const stage = ticketOrMeta.delivery_stage;
  const rejected = stage === 'rejected' || Boolean(String(ticketOrMeta.reject_reason || '').trim());
  if (!rejected) return '';
  if (ticketOrMeta.review_match === false) return IP_MISMATCH_REASON;
  return GENERIC_REJECT_REASON;
}

export function ticketBucket(ticket, role) {
  const stage = ticket.delivery_stage || stageFromStatus(ticket.status);
  if (stage === 'done') return 'completed';
  if (stage === 'rejected') return 'history';
  if (stage === 'submitted' && ticket.reject_reason) return 'history';
  if (role === 'operator') return stage === 'submitted' ? 'act' : 'prog';
  return stage === 'posted' ? 'act' : 'prog';
}
