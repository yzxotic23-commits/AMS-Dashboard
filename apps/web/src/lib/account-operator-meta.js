/** Operator workflow fields stored in accounts.notes as JSON (no DB migration). */

import { inferBrand, inferBrandFromDevice } from './account-status-labels';
import { normalizeHubOwner } from './hub-operators';

const META_PREFIX = '_ams_op:';

function normalizeIpJoin(ip) {
  if (!ip) return null;
  if (Array.isArray(ip)) return ip[0] || null;
  return ip;
}

export function parseOperatorMeta(account) {
  if (account?._meta) return { ...account._meta };
  const notes = account?.notes || '';
  const idx = notes.indexOf(META_PREFIX);
  if (idx === -1) return {};
  try {
    return JSON.parse(notes.slice(idx + META_PREFIX.length));
  } catch {
    return {};
  }
}

export function serializeAccountNotes(meta, humanNote = '') {
  const clean = humanNote.replace(new RegExp(`${META_PREFIX}[\\s\\S]*$`), '').trim();
  const payload = `${META_PREFIX}${JSON.stringify(meta)}`;
  return clean ? `${clean}\n${payload}` : payload;
}

export function formatSimLabel(simRow) {
  if (!simRow?.phone_number) return '';
  return `${simRow.carrier || 'SIM'} · ${simRow.phone_number}`;
}

export function accountToOperatorRow(account) {
  const meta = parseOperatorMeta(account);
  const simJoin = account.sims || null;
  const deviceJoin = account.devices || null;
  const ipJoin = normalizeIpJoin(account.ips);
  return {
    id: account.id,
    account_name: account.account_name,
    phone_number: account.phone_number || '',
    status: account.status,
    wsaf_slot: account.wsaf_slot ?? null,
    siteKey: meta.site_key
      || inferSiteFromIp(ipJoin?.ip_address)
      || inferSiteFromSim(simJoin)
      || 'my',
    device_id: account.device_id ?? null,
    device: deviceJoin?.device_name || '',
    sim_id: account.sim_id ?? null,
    sim: formatSimLabel(simJoin)
      || (meta.prepared_telco && account.phone_number
        ? `${meta.prepared_telco} · ${account.phone_number}`
        : ''),
    ip_id: account.ip_id ?? null,
    ip: ipJoin?.ip_address || '',
    bind_proxy: ipJoin ? {
      ip_address: ipJoin.ip_address || '',
      port: String(ipJoin.port || '8080'),
      username: ipJoin.username || '',
      password: ipJoin.password || '',
    } : null,
    channel: meta.channel || '',
    prepared_telco: meta.prepared_telco || '',
    linked_override: Boolean(meta.linked_override),
    nurturing_phase: meta.nurturing_phase || 'manual',
    nurturing_started_at: meta.nurturing_started_at || account.registration_date || account.created_at || account.updated_at,
    human_note: meta.human_note || '',
    reference_ip_id: meta.reference_ip_id || account.ip_id || null,
    reference_ip_address: meta.reference_ip_address || ipJoin?.ip_address || '',
    last_health_check_at: meta.last_health_check_at || null,
    engine_status: meta.engine_status || null,
    owner: normalizeHubOwner(meta.owner),
    brand: meta.brand
      || inferBrand(account.account_name)
      || inferBrandFromDevice(deviceJoin?.device_name)
      || '',
    _notes: account.notes || '',
  };
}

function inferSiteFromIp(ip) {
  if (!ip) return null;
  if (String(ip).startsWith('103.') || String(ip).startsWith('45.')) return 'my';
  if (String(ip).startsWith('175.') || String(ip).startsWith('192.')) return 'pp';
  return null;
}

function inferSiteFromSim(simRow) {
  if (!simRow) return null;
  const loc = String(simRow.location || '').toLowerCase();
  if (loc.includes('poipet')) return 'pp';
  const phone = String(simRow.phone_number || '');
  if (phone.startsWith('+855')) return 'pp';
  if (phone.startsWith('+60')) return 'my';
  return null;
}

export function ipSiteKey(ipRow) {
  if (ipRow?.country === 'MY') return 'my';
  if (ipRow?.country === 'PP' || ipRow?.country === 'KH') return 'pp';
  return inferSiteFromIp(ipRow?.ip_address) || 'my';
}

export function buildMetaPatch(row, patch) {
  const next = {
    site_key: row.siteKey,
    channel: row.channel,
    prepared_telco: row.prepared_telco,
    linked_override: row.linked_override,
    nurturing_phase: row.nurturing_phase,
    nurturing_started_at: row.nurturing_started_at,
    human_note: row.human_note,
    reference_ip_id: row.reference_ip_id,
    reference_ip_address: row.reference_ip_address,
    last_health_check_at: row.last_health_check_at,
    engine_status: row.engine_status,
    owner: row.owner,
    brand: row.brand,
    ...patch,
  };
  return serializeAccountNotes(
    {
      site_key: next.site_key,
      channel: next.channel,
      prepared_telco: next.prepared_telco,
      linked_override: next.linked_override,
      nurturing_phase: next.nurturing_phase,
      nurturing_started_at: next.nurturing_started_at,
      human_note: next.human_note,
      reference_ip_id: next.reference_ip_id,
      reference_ip_address: next.reference_ip_address,
      last_health_check_at: next.last_health_check_at,
      engine_status: next.engine_status,
      owner: next.owner || undefined,
      brand: next.brand || undefined,
    },
    next.human_note || '',
  );
}
