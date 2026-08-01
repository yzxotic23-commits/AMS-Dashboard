/** Feeding run outcomes only. Disconnect is live slot.connected — never a status here. */
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

/**
 * Payload for operator Strict → Restrict / Banned → Banned in FeedFlow audit.
 * Unique runId so each mark appends (not wiped by ams-linked audit sync).
 *
 * @param {object} row
 * @param {string} feedingStatus
 * @param {{ restrictKind?: 'restrict_scan' | 'restrict_chat_new' }} [opts]
 */
export function nurturingOutcomeAuditPayload(row, feedingStatus, opts = {}) {
  let reason = 'operator_strict';
  if (feedingStatus === FEEDING_STATUS.BANNED) {
    reason = 'operator_banned';
  } else if (opts.restrictKind === 'restrict_scan') {
    reason = 'operator_strict_scan';
  } else if (opts.restrictKind === 'restrict_chat_new') {
    reason = 'operator_strict_chat_new';
  }
  const siteKey = row?.siteKey || 'my';
  return {
    slot: row.wsaf_slot,
    accountName: row.acct || row.account_name,
    feedingStatus,
    reason,
    restrictKind: opts.restrictKind || null,
    runId: `ams-nurture-${reason}-${row.id}-${Date.now()}`,
    location: SITES[siteKey]?.name || null,
    ipAddress: row.ip || null,
    // Restricted Scan = cannot scan during restriction; Chat New = scan still possible.
    strictScanPossible: feedingStatus === FEEDING_STATUS.RESTRICT
      && opts.restrictKind !== 'restrict_chat_new',
  };
}

export { FEEDING_STATUS };

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

/** Human Current Status labels (Sinyee / R&M wording). */
export const CURRENT_STATUS = {
  ACTIVE: 'Active',
  SUCCESS: 'Success',
  RESTRICTED_SCAN: 'Restricted Scan',
  RESTRICTED_CHAT_NEW: 'Restricted Chat New Contact',
  RESTRICT: 'Restrict',
  BANNED: 'Banned',
};

const CURRENT_STATUS_FROM_REASON = {
  operator_strict_scan: CURRENT_STATUS.RESTRICTED_SCAN,
  operator_strict_chat_new: CURRENT_STATUS.RESTRICTED_CHAT_NEW,
  operator_strict: CURRENT_STATUS.RESTRICT,
  operator_banned: CURRENT_STATUS.BANNED,
};

const CURRENT_STATUS_FROM_KIND = {
  restrict_scan: CURRENT_STATUS.RESTRICTED_SCAN,
  restrict_chat_new: CURRENT_STATUS.RESTRICTED_CHAT_NEW,
};

/**
 * Map a Feeding Audit row → Current Status shown next to Account.
 * Restrict + subtype reason → Restricted Scan / Restricted Chat New Contact.
 */
export function feedingEntryCurrentStatus(entry) {
  if (!entry) return CURRENT_STATUS.ACTIVE;
  const status = entry.feedingStatus;
  const reason = String(entry.reason || '');
  if (status === FEEDING_STATUS.BANNED || /banned/i.test(reason)) {
    return CURRENT_STATUS.BANNED;
  }
  if (reason === 'operator_status_active') {
    return CURRENT_STATUS.ACTIVE;
  }
  if (status === FEEDING_STATUS.RESTRICT || /strict|restrict/i.test(reason)) {
    return CURRENT_STATUS_FROM_REASON[reason] || CURRENT_STATUS.RESTRICT;
  }
  if (status === FEEDING_STATUS.SUCCESS) return CURRENT_STATUS.SUCCESS;
  if (status === FEEDING_STATUS.ACTIVE) return CURRENT_STATUS.ACTIVE;
  return status || CURRENT_STATUS.ACTIVE;
}

/** Latest Current Status per account name (audit history + AMS restrict_kind). */
export function buildAccountCurrentStatuses(entries = [], accounts = []) {
  const byName = new Map();

  const sorted = [...entries].sort((a, b) => {
    const ta = new Date(a.ts || a.dateTime || 0).getTime();
    const tb = new Date(b.ts || b.dateTime || 0).getTime();
    return tb - ta;
  });

  for (const e of sorted) {
    const name = String(e.accountName || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, {
      accountName: name,
      currentStatus: feedingEntryCurrentStatus(e),
      source: 'feeding_audit',
      when: e.dateTime || e.ts || null,
      ipAddress: e.ipAddress || null,
      location: e.location || null,
    });
  }

  for (const a of accounts) {
    const name = String(a.account_name || a.acct || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const fromKind = CURRENT_STATUS_FROM_KIND[a.restrict_kind];
    if (fromKind) {
      const prev = byName.get(key);
      byName.set(key, {
        accountName: name,
        currentStatus: fromKind,
        source: 'ams',
        when: prev?.when || null,
        ipAddress: a.ip || prev?.ipAddress || null,
        location: prev?.location || SITES[a.siteKey]?.name || null,
      });
    } else if (!byName.has(key) && (a.status === 'IN_USE' || a.status === 'NURTURING' || a.status === 'AVAILABLE')) {
      byName.set(key, {
        accountName: name,
        currentStatus: CURRENT_STATUS.ACTIVE,
        source: 'ams',
        when: null,
        ipAddress: a.ip || null,
        location: SITES[a.siteKey]?.name || null,
      });
    }
  }

  const rows = [...byName.values()].sort((a, b) => a.accountName.localeCompare(b.accountName));
  const counts = {
    [CURRENT_STATUS.ACTIVE]: 0,
    [CURRENT_STATUS.SUCCESS]: 0,
    [CURRENT_STATUS.RESTRICTED_SCAN]: 0,
    [CURRENT_STATUS.RESTRICTED_CHAT_NEW]: 0,
    [CURRENT_STATUS.RESTRICT]: 0,
    [CURRENT_STATUS.BANNED]: 0,
  };
  for (const r of rows) {
    counts[r.currentStatus] = (counts[r.currentStatus] || 0) + 1;
  }
  return { rows, counts };
}
