import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { enrichProfilesSiteKey } from '../../lib/profile-site.js';

const router = Router();
router.use(authenticate);

/** GET /operators — pipeline operator roster (role=operator only, not Admin Master) */
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, full_name, role, site_key')
      .eq('role', 'operator')
      .eq('is_active', true)
      .order('full_name', { ascending: true });
    if (error) throw error;
    const rows = await enrichProfilesSiteKey(data || []);
    res.json({
      data: rows.map((u) => ({
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        site_key: u.site_key,
        label: u.full_name || u.username,
      })),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
