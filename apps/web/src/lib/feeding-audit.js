const FEEDING_STATUS = {
  ACTIVE: 'Active',
  SUCCESS: 'Success',
  RESTRICT: 'Restrict',
  BANNED: 'Banned',
};

import { SITES } from './sites';

/** Body for POST /bridge/slots/:slot/display-label from an AMS account row. */
export function feedflowSlotLabelBody(account) {
  const siteKey = account?.siteKey || 'my';
  return {
    accountName: account?.account_name,
    phone: account?.phone_number || null,
    siteKey,
    location: SITES[siteKey]?.name || null,
    ipAddress: account?.ip || null,
  };
}

/** Map audit row location string → site id (my | pp), or null if unknown. */
export function feedingEntrySiteKey(location) {
  const l = String(location || '').trim().toLowerCase();
  if (!l || l === '-') return null;
  if (l.includes('malaysia') || l === 'my') return 'my';
  if (l.includes('poipet') || l === 'pp') return 'pp';
  return null;
}

export function filterFeedingAuditBySite(entries, site) {
  if (!Array.isArray(entries)) return [];
  if (site === 'all') return entries;
  return entries.filter((e) => {
    const key = feedingEntrySiteKey(e.location);
    return key === site || key == null;
  });
}

/** Fill blank audit locations from AMS account siteKey (engine Success rows often omit location). */
export function enrichFeedingAuditLocations(entries, accounts = []) {
  if (!Array.isArray(entries) || !entries.length) return entries || [];
  if (!Array.isArray(accounts) || !accounts.length) return entries;

  const byName = new Map();
  for (const a of accounts) {
    const name = String(a?.account_name || '').trim().toLowerCase();
    if (!name) continue;
    const label = SITES[a.siteKey]?.name || null;
    if (label) byName.set(name, label);
  }

  return entries.map((e) => {
    const loc = String(e?.location || '').trim();
    if (loc && loc !== '-' && loc.toLowerCase() !== 'pending') return e;
    const name = String(e?.accountName || '').trim().toLowerCase();
    const filled = name ? byName.get(name) : null;
    if (!filled) return e;
    return { ...e, location: filled };
  });
}

function pct(n, total) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

const COMPLETED_STATUSES = new Set([
  FEEDING_STATUS.SUCCESS,
  FEEDING_STATUS.RESTRICT,
  FEEDING_STATUS.BANNED,
]);

/** Recompute summary from a (possibly filtered) entry list.
 *  Total volume = completed outcomes only (Success + Restrict + Banned).
 *  Active / linked rows are excluded from volume and rate denominators.
 */
export function computeFeedingAuditSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const count = (status) => list.filter((e) => e.feedingStatus === status).length;
  const banned = count(FEEDING_STATUS.BANNED);
  const restrict = count(FEEDING_STATUS.RESTRICT);
  const success = count(FEEDING_STATUS.SUCCESS);
  const total = success + restrict + banned;
  const active = count(FEEDING_STATUS.ACTIVE);

  const ipMap = new Map();
  for (const e of list) {
    if (!COMPLETED_STATUSES.has(e.feedingStatus)) continue;
    const ip = e.ipAddress || 'direct';
    if (!ipMap.has(ip)) ipMap.set(ip, { banned: 0 });
    if (e.feedingStatus === FEEDING_STATUS.BANNED) {
      ipMap.get(ip).banned += 1;
    }
  }
  const uniqueIpsWithBan = [...ipMap.values()].filter((r) => r.banned > 0).length;

  return {
    totalFeedingVolume: total,
    activeVolume: active,
    bannedVolume: banned,
    bannedRate: pct(banned, total),
    restrictVolume: restrict,
    restrictRate: pct(restrict, total),
    successVolume: success,
    successRate: pct(success, total),
    uniqueIpsWithBan,
  };
}
