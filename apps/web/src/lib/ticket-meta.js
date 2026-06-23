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
