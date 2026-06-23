import { supabaseAdmin } from './supabase.js';

export function normalizeIpJoin(ip) {
  if (!ip) return null;
  if (Array.isArray(ip)) return ip[0] || null;
  return ip;
}

/** Ensure nested ips embed includes full proxy credentials from ips table. */
export async function enrichAccountsIpEmbed(rows) {
  const list = rows || [];
  const ids = [...new Set(list.map((row) => row.ip_id).filter(Boolean))];
  if (!ids.length) return list;

  const { data: ips, error } = await supabaseAdmin
    .from('ips')
    .select('id, ip_address, port, username, password, country')
    .in('id', ids);
  if (error) throw error;

  const byId = Object.fromEntries((ips || []).map((ip) => [ip.id, ip]));
  return list.map((row) => {
    if (!row.ip_id || !byId[row.ip_id]) return row;
    const current = normalizeIpJoin(row.ips);
    return { ...row, ips: { ...(current || {}), ...byId[row.ip_id] } };
  });
}
