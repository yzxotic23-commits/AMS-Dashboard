import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { parsePagination, paginatedResponse } from '../../lib/pagination.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator'));

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    let q = supabaseAdmin
      .from('audit_logs')
      .select('*, profiles(full_name, email)', { count: 'exact' });

    if (req.query.entity_type) q = q.eq('entity_type', req.query.entity_type);
    if (req.query.action) q = q.eq('action', req.query.action);

    const { data, error, count } = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json(paginatedResponse(data, count || 0, page, limit));
  } catch (e) {
    next(e);
  }
});

export default router;
