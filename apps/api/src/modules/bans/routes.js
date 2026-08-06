import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { parsePagination, paginatedResponse } from '../../lib/pagination.js';
import { parseOperatorMeta } from '../../lib/accountMeta.js';
import {
  buildBanRecords, aggregateBanStats, parseBanReason, banStageLabel,
} from '../../lib/banAnalytics.js';
import { ACCOUNT_SELECT_BAN } from '../../lib/accountSelect.js';
import { parseDateRangeQuery, inDateRange } from '../../lib/dateRange.js';
import { accountInBrandScope, profileBrandScope } from '../../lib/accountBrand.js';

const router = Router();
router.use(authenticate);

function enrichAccountRow(row) {
  const meta = parseOperatorMeta(row);
  return {
    ...row,
    site_key: meta.site_key || 'my',
    channel: meta.channel || '',
  };
}

async function loadBanData() {
  const { data: history } = await supabaseAdmin
    .from('account_status_history')
    .select('*, profiles(full_name)')
    .eq('to_status', 'BANNED')
    .order('changed_at', { ascending: false });

  const accountIds = [...new Set((history || []).map((h) => h.account_id))];
  let accountsById = {};
  if (accountIds.length) {
    const { data: accounts } = await supabaseAdmin
      .from('accounts')
      .select(ACCOUNT_SELECT_BAN)
      .in('id', accountIds);
    accountsById = Object.fromEntries((accounts || []).map((a) => [a.id, enrichAccountRow(a)]));
  }

  const records = buildBanRecords(history || [], accountsById);
  return { records, accountsById };
}

function filterRecordsByBrand(records, accountsById, profile) {
  const scope = profileBrandScope(profile);
  if (!scope) return records;
  if (!scope.length) return [];
  return records.filter((r) => accountInBrandScope(accountsById[r.account_id], scope));
}

router.get('/stats', requireRole('admin', 'operator', 'business'), async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key || 'all';
    const range = parseDateRangeQuery(req.query);
    const { records, accountsById } = await loadBanData();
    let scoped = filterRecordsByBrand(records, accountsById, req.profile);
    const filtered = range
      ? scoped.filter((r) => inDateRange(r.changed_at, range))
      : scoped;
    const stats = aggregateBanStats(filtered, { siteKey });

    const brandScope = profileBrandScope(req.profile);
    let poolSize = 0;
    if (brandScope) {
      const { data: poolAccounts } = await supabaseAdmin
        .from('accounts')
        .select('id, notes, account_name, device_id')
        .neq('status', 'RECYCLED')
        .limit(2000);
      poolSize = (poolAccounts || []).filter((a) => accountInBrandScope(a, brandScope)).length;
    } else {
      const { count } = await supabaseAdmin
        .from('accounts')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'RECYCLED');
      poolSize = count || 0;
    }

    const overallPct = poolSize > 0
      ? Math.round((stats.total / poolSize) * 1000) / 10
      : 0;

    const { data: flaggedIps } = await supabaseAdmin
      .from('ips')
      .select('id, ip_address, risk_count, status')
      .or(`risk_count.gte.${stats.badIpThreshold},status.eq.FLAGGED`)
      .order('risk_count', { ascending: false })
      .limit(10);

    res.json({
      ...stats,
      overallPct,
      poolSize,
      flaggedIps: flaggedIps || [],
      date_range: range ? { from: range.from, to: range.to } : null,
    });
  } catch (e) {
    next(e);
  }
});

router.use(requireRole('admin', 'operator'));
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const siteKey = req.query.site || req.query.site_key;
    const { records } = await loadBanData();

    let list = records;
    if (siteKey && siteKey !== 'all') {
      list = list.filter((r) => r.site_key === siteKey);
    }
    if (req.query.stage) {
      list = list.filter((r) => r.stage === req.query.stage);
    }

    const slice = list.slice(offset, offset + limit);
    res.json(paginatedResponse(slice, list.length, page, limit));
  } catch (e) {
    next(e);
  }
});

export { parseBanReason, banStageLabel, buildBanRecords, aggregateBanStats };
export default router;
