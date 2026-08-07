import { formatSimLabel, ipSiteKey } from './account-operator-meta';
import {
  daysLeftFromExpiryDate,
  parseSimNotesMeta,
  resolveSimExpiryDate,
  simLocationLabel,
} from './sim-meta';

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
  const site = row.site_key || row.site || inferSimSite(row);
  const siteName = row.site_name || simLocationLabel(row);
  const ledger = parseSimNotesMeta(row.notes).ledger;
  const lastCharged = row.last_charged || ledger.last_charged || null;
  const lastCycleDays = row.last_cycle_days || ledger.last_cycle_days || 30;
  const expiryDate = resolveSimExpiryDate(
    { ...row, last_charged: lastCharged, last_cycle_days: lastCycleDays },
    ledger,
  );
  const daysLeft = daysLeftFromExpiryDate(expiryDate);
  return {
    id: row.id,
    phone_number: row.phone_number,
    carrier: row.carrier || row.telco || '—',
    location: siteName,
    site,
    site_name: siteName,
    account_name: row.account_name || row.accounts?.account_name || '—',
    brand: row.brand || null,
    expiry_date: expiryDate,
    days_left: daysLeft,
    last_charged: lastCharged,
    last_amount: row.last_amount ?? ledger.last_amount ?? null,
    last_cycle_days: lastCycleDays,
    last_plan: row.last_plan || ledger.last_plan || null,
    topup_count: row.topup_count
      ?? (Array.isArray(ledger.topups) ? ledger.topups.length : (ledger.last_charged ? 1 : 0)),
    ledger_status: row.ledger_status || ledger.ledger_status || 'active',
    last_exception: row.last_exception || ledger.last_exception || null,
    remark: row.remark ?? ledger.remark ?? null,
    remark_updated_at: row.remark_updated_at || ledger.remark_updated_at || null,
    remark_updated_by: row.remark_updated_by || ledger.remark_updated_by || null,
  };
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
  return rows.filter((d) => {
    if (d.site_key === 'my' || d.site_key === 'pp') return d.site_key === siteKey;
    const name = String(d.device_name || '').toUpperCase();
    // Legacy SGD without site_key stays visible on both sites
    if (name.startsWith('SGD')) return true;
    if (siteKey === 'pp') return name.startsWith('PP');
    return name.startsWith('MYR') || name.startsWith('MY');
  });
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
