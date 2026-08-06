import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { parseOperatorMeta, parsePrefixedJsonBlock } from '../../lib/accountMeta.js';
import { parseDateRangeQuery, inDateRange } from '../../lib/dateRange.js';
import { accountInBrandScope, profileBrandScope } from '../../lib/accountBrand.js';

const REC_PREFIX = '_ams_rec:';

function parseRecoveryMeta(notes) {
  return parsePrefixedJsonBlock(notes, REC_PREFIX);
}

const router = Router();
router.use(authenticate);

// GET /recovery/stats — recovery success/fail breakdown (Feature 9)
router.get('/stats', requireRole('admin', 'operator', 'business'), async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const range = parseDateRangeQuery(req.query);
    const brandScope = profileBrandScope(req.profile);
    const { data: accounts, error } = await supabaseAdmin
      .from('accounts')
      .select('id, notes, status, account_name, device_id')
      .in('status', ['BANNED', 'RECOVERING', 'RECYCLED', 'AVAILABLE', 'NURTURING']);
    if (error) throw error;

    const attempts = [];
    (accounts || []).forEach((a) => {
      if (!accountInBrandScope(a, brandScope)) return;
      const rec = parseRecoveryMeta(a.notes);
      if (!rec?.log?.length) return;
      const meta = parseOperatorMeta(a);
      if (siteKey && siteKey !== 'all' && meta.site_key !== siteKey) return;
      (rec.log || []).forEach((entry) => {
        if (entry.st === 'ok' || entry.st === 'fail') {
          if (range && !inDateRange(entry.time, range)) return;
          attempts.push({ result: entry.st, reason: entry.reason || '' });
        }
      });
      if (!range && rec.recovery_status === 'doing') {
        attempts.push({ result: 'pending', reason: '' });
      }
    });

    const completed = attempts.filter((a) => a.result !== 'pending');
    const success = completed.filter((a) => a.result === 'ok').length;
    const failed = completed.filter((a) => a.result === 'fail').length;
    const total = completed.length;
    const rate = total > 0 ? Math.round((success / total) * 1000) / 10 : 0;

    const byReason = {};
    completed.filter((a) => a.result === 'fail').forEach((a) => {
      const r = a.reason || 'Other';
      byReason[r] = (byReason[r] || 0) + 1;
    });
    const reasonTotal = failed || 1;
    const failReasons = Object.entries(byReason).map(([label, count]) => ({
      label,
      count,
      pct: Math.round((count / reasonTotal) * 100),
    }));

    res.json({
      total,
      success,
      failed,
      pending: attempts.filter((a) => a.result === 'pending').length,
      successRate: rate,
      failReasons,
      detail: `${total} attempts · ${success} success · ${failed} failed`,
      date_range: range ? { from: range.from, to: range.to } : null,
    });
  } catch (e) {
    next(e);
  }
});

router.use(requireRole('admin', 'operator'));

export default router;
