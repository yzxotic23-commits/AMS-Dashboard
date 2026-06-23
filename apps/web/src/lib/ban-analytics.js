/** Parse ban stage/reason from status history reason string. */
export function parseBanReason(reason) {
  const text = String(reason || '');
  const m = text.match(/^\[(manual|auto)\]\s*(.+?)(?:\s·\s(.+))?$/i);
  if (m) {
    return { stage: m[1].toLowerCase(), reason: m[2].trim(), source: m[3]?.trim() || '' };
  }
  return { stage: 'unknown', reason: text || 'Unknown', source: '' };
}

export function banStageLabel(fromStatus, parsed) {
  if (fromStatus === 'REGISTERING') return 'At Registration';
  if (fromStatus === 'IN_USE') return 'In Use';
  if (fromStatus === 'NURTURING') {
    return parsed.stage === 'manual' ? 'Manual Nurture' : 'Auto Nurture';
  }
  if (parsed.stage === 'manual') return 'Manual Nurture';
  if (parsed.stage === 'auto') return 'Auto Nurture';
  return 'Other';
}

export function phoneSegment(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('60')) return '+60 Malaysia';
  if (digits.startsWith('855')) return '+855 Cambodia';
  if (digits.length >= 6) return `${digits.slice(0, 4)}…`;
  return 'Unknown';
}

export const BAD_IP_WARN_THRESHOLD = 4;
export const BAD_IP_FLAG_THRESHOLD = 8;

export function buildBanRecords(historyRows, accountsById) {
  return (historyRows || [])
    .filter((h) => h.to_status === 'BANNED')
    .map((h) => {
      const account = accountsById[h.account_id] || {};
      const parsed = parseBanReason(h.reason);
      return {
        id: h.id,
        account_id: h.account_id,
        account_name: account.account_name || '—',
        phone_number: account.phone_number || '',
        from_status: h.from_status,
        stage: parsed.stage,
        reason: parsed.reason,
        source: parsed.source,
        stage_label: banStageLabel(h.from_status, parsed),
        ip: account.ips?.ip_address || account.ip || '—',
        device: account.devices?.device_name || account.device || '—',
        channel: account.channel || account._channel || '—',
        site_key: account.site_key || account.siteKey || 'my',
        changed_at: h.changed_at,
        operator: h.profiles?.full_name || 'System',
      };
    });
}

export function aggregateBanStats(records, { siteKey } = {}) {
  let rows = records;
  if (siteKey && siteKey !== 'all') {
    rows = rows.filter((r) => r.site_key === siteKey);
  }

  const total = rows.length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  const byStageMap = {};
  rows.forEach((r) => {
    byStageMap[r.stage_label] = (byStageMap[r.stage_label] || 0) + 1;
  });

  const stageOrder = ['At Registration', 'Manual Nurture', 'Auto Nurture', 'In Use', 'Other'];
  const byStage = stageOrder
    .filter((name) => byStageMap[name])
    .map((name) => ({ name, count: byStageMap[name], pct: pct(byStageMap[name]) }));

  const sumTop = (map, limit = 5) => Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, pct: pct(count) }));

  const byIp = {};
  const byDevice = {};
  const byMethod = {};
  const bySegment = {};
  const byReason = {};

  rows.forEach((r) => {
    byIp[r.ip] = (byIp[r.ip] || 0) + 1;
    byDevice[r.device] = (byDevice[r.device] || 0) + 1;
    byMethod[r.channel || '—'] = (byMethod[r.channel || '—'] || 0) + 1;
    bySegment[phoneSegment(r.phone_number)] = (bySegment[phoneSegment(r.phone_number)] || 0) + 1;
    byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  });

  return {
    total,
    overallRate: total, // caller computes rate vs pool if needed
    byStage,
    byIp: sumTop(byIp),
    byDevice: sumTop(byDevice),
    byMethod: sumTop(byMethod),
    bySegment: sumTop(bySegment),
    byReason: sumTop(byReason, 8),
    badIpThreshold: BAD_IP_FLAG_THRESHOLD,
    warnIpThreshold: BAD_IP_WARN_THRESHOLD,
  };
}
