import { formatSimLabel, ipSiteKey } from './account-operator-meta';
import { parseSimNotesMeta, simLocationLabel } from './sim-meta';

export function mapIpRow(row) {
  const active = row.status === 'ACTIVE' || row.active === true;
  return {
    ...row,
    active,
    in_use: row.in_use ?? row.assigned_count ?? (row.assigned_account_id ? 1 : 0),
    risk_count: row.risk_count ?? 0,
  };
}

export function mapSimRow(row) {
  const expiry = row.expiry_date ? new Date(`${row.expiry_date}T12:00:00`) : null;
  const daysLeft = row.days_left ?? (expiry
    ? Math.max(0, Math.ceil((expiry - Date.now()) / 86400000))
    : 0);
  const location = simLocationLabel(row);
  const mapped = {
    id: row.id,
    phone_number: row.phone_number,
    carrier: row.carrier || row.telco || '—',
    location,
    account_name: row.account_name || row.accounts?.account_name || '—',
    days_left: daysLeft,
    last_charged: row.last_charged || parseSimNotesMeta(row.notes).ledger.last_charged || null,
  };
  return { ...mapped, site: inferSimSite({ ...mapped, notes: row.notes }) };
}

export function inferSimSite(simRow) {
  const loc = String(simRow.location || simRow.notes || '').toLowerCase();
  if (loc.includes('poipet')) return 'pp';
  if (String(simRow.phone_number || '').startsWith('+855')) return 'pp';
  return 'my';
}

export function simOptionFromRow(row) {
  return {
    id: row.id,
    label: formatSimLabel(row),
    site: inferSimSite(row),
  };
}

export function filterIpsBySite(rows, siteKey) {
  if (siteKey === 'all') return rows;
  return rows.filter((ip) => ipSiteKey(ip) === siteKey);
}

export function filterDevicesBySite(rows, siteKey) {
  if (siteKey === 'all') return rows;
  const prefix = siteKey === 'my' ? 'MYR' : 'PP';
  return rows.filter((d) => d.device_name?.startsWith(prefix));
}

export function filterSimsBySite(rows, siteKey) {
  if (siteKey === 'all') return rows;
  return rows.filter((r) => r.site === siteKey);
}

export function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function matchSimIdForPrepared(phone, telco, simRows) {
  const target = phoneDigits(phone);
  if (!target) return null;
  const exact = simRows.find((s) => phoneDigits(s.label) === target);
  if (exact) return exact.id;
  const tail = target.slice(-9);
  const byTail = simRows.find((s) => phoneDigits(s.label).endsWith(tail));
  if (byTail) return byTail.id;
  const byTelco = simRows.filter((s) => s.label.startsWith(`${telco} ·`));
  if (byTelco.length === 1 && phoneDigits(byTelco[0].label) === target) return byTelco[0].id;
  return null;
}
