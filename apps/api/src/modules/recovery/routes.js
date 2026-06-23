import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { parseOperatorMeta } from '../../lib/accountMeta.js';

const REC_PREFIX = '_ams_rec:';

function parseRecoveryMeta(notes) {
  const idx = (notes || '').indexOf(REC_PREFIX);
  if (idx === -1) return null;
  try {
    return JSON.parse(notes.slice(idx + REC_PREFIX.length));
  } catch {
    return null;
  }
}

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator'));

// GET /recovery/stats — recovery success/fail breakdown (Feature 9)
router.get('/stats', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const { data: accounts, error } = await supabaseAdmin
      .from('accounts')
      .select('id, notes, status')
      .in('status', ['BANNED', 'RECOVERING', 'RECYCLED', 'AVAILABLE', 'NURTURING']);
    if (error) throw error;

    const attempts = [];
    (accounts || []).forEach((a) => {
      const rec = parseRecoveryMeta(a.notes);
      if (!rec?.log?.length) return;
      const meta = parseOperatorMeta(a);
      if (siteKey && siteKey !== 'all' && meta.site_key !== siteKey) return;
      const last = rec.log[rec.log.length - 1];
      if (last.st === 'ok' || last.st === 'fail') {
        attempts.push({ result: last.st, reason: last.reason || '' });
      } else if (rec.recovery_status === 'doing') {
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
    });
  } catch (e) {
    next(e);
  }
});

export default router;
