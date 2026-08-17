export const DELIVERY_STATE = {
  submitted: { label: 'Awaiting operator review', pill: 'badge-warn' },
  submitted_match: { label: 'Ready for go live', pill: 'badge-success' },
  submitted_mismatch: { label: 'IP mismatch', pill: 'badge-danger' },
  posted: { label: 'Awaiting business confirm', pill: 'badge-accent' },
  rejected: { label: 'Rejected', pill: 'badge-danger' },
  done: { label: 'Completed', pill: 'badge-success' },
};

export function ticketStatusMeta(ticket) {
  const stage = ticket.delivery_stage || 'submitted';
  const reviewMatch = ticket.review_match;
  const isRejected = stage === 'rejected' || (stage === 'submitted' && ticket.reject_reason);

  if (isRejected) return DELIVERY_STATE.rejected;
  if (stage === 'posted') return DELIVERY_STATE.posted;
  if (stage === 'done') return DELIVERY_STATE.done;
  if (stage === 'submitted' && reviewMatch === true) return DELIVERY_STATE.submitted_match;
  if (stage === 'submitted' && reviewMatch === false) return DELIVERY_STATE.submitted_mismatch;
  return DELIVERY_STATE.submitted;
}

export function ticketStepCursor(stage, reviewMatch) {
  if (stage === 'rejected') return 1;
  if (stage === 'submitted') {
    if (reviewMatch === true) return 2;
    return 1;
  }
  if (stage === 'posted') return 3;
  return 4;
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

export function ticketBucket(ticket, role) {
  const stage = ticket.delivery_stage || 'submitted';
  if (stage === 'done') return 'completed';
  if (stage === 'rejected') return 'history';
  if (stage === 'submitted' && ticket.reject_reason) return 'history';
  if (role === 'operator') return stage === 'submitted' ? 'act' : 'prog';
  return stage === 'posted' ? 'act' : 'prog';
}

export function stepIndex(stage, reviewMatch) {
  return ticketStepCursor(stage, reviewMatch);
}

export const DELIVERY_STEPS = ['Submit', 'Review', 'Go live', 'Confirm', 'Done'];

export const TICKETS_PAGE_SIZE = 5;

export function normalizeTicketSearchQuery(query) {
  return String(query || '').trim().toLowerCase().replace(/^#+/, '');
}

export function ticketMatchesSearch(ticket, query) {
  const q = normalizeTicketSearchQuery(query);
  if (!q) return true;

  const bind = ticket.bind_proxy;
  const shot = ticket.shot_proxy;
  const ticketNo = String(ticket.ticket_number || '');
  const ticketNoPlain = ticketNo.replace(/^t-/i, '');
  const hay = [
    ticket.account_name,
    ticket.owner,
    ticket.customer_name,
    ticket.requester_name,
    ticket.phone_number,
    ticket.device_name,
    ticket.channel,
    ticketNo,
    ticketNoPlain,
    ticketNo ? `#${ticketNo.toLowerCase()}` : '',
    ticket.id,
    bind?.ip_address,
    bind?.port,
    shot?.ip_address,
    shot?.port,
    bind ? `${bind.ip_address}:${bind.port}` : '',
    shot ? `${shot.ip_address}:${shot.port}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return hay.includes(q);
}

export const REJECT_REASON_OTHER = 'Other';

export const REJECT_REASONS = [
  'IP mismatch — proxy screenshot does not match bound IP',
  'Unclear screenshot',
  'Wrong link code',
  REJECT_REASON_OTHER,
];

const PLACEHOLDER_REJECT = /^(fail|failed|rejected|error|mismatch|false|true)$/i;

export function ticketRejectReasonText(ticket) {
  const candidates = [
    ticket?.reject_reason,
    ticket?.reason,
    ticket?.review_note,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (text && !PLACEHOLDER_REJECT.test(text)) return text;
  }
  const stage = ticket?.delivery_stage;
  const rejected = stage === 'rejected' || Boolean(String(ticket?.reject_reason || '').trim());
  if (!rejected) return '';
  if (ticket?.review_match === false) return REJECT_REASONS[0];
  return 'Rejected during IP review — resubmit with a corrected screenshot';
}
