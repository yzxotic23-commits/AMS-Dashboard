import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

router.get('/', authenticate, async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('v_dashboard_stats').select('*').single();
    if (error) throw error;

    const { data: recentAudit } = await supabaseAdmin
      .from('audit_logs')
      .select('id, entity_type, action, created_at, user_id, profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: recentTickets } = await supabaseAdmin
      .from('tickets')
      .select('id, ticket_number, title, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    res.json({
      stats: data,
      recentActivity: recentAudit || [],
      recentTickets: recentTickets || [],
    });
  } catch (e) {
    next(e);
  }
});

export default router;
