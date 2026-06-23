import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { parseOperatorMeta } from '../../lib/accountMeta.js';
import { parseTicketMeta, proxyFromIp, proxyMatch } from '../../lib/ticketMeta.js';
import { ACCOUNT_SELECT_IP_GATE } from '../../lib/accountSelect.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator'));

// GET /ip-gate — pending review queue
router.get('/', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const { data: reviews, error } = await supabaseAdmin
      .from('ip_gate_reviews')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const rows = [];
    for (const rev of reviews || []) {
      const { data: account } = await supabaseAdmin
        .from('accounts')
        .select(ACCOUNT_SELECT_IP_GATE)
        .eq('id', rev.account_id)
        .single();

      const { data: tickets } = await supabaseAdmin
        .from('tickets')
        .select('*')
        .eq('account_id', rev.account_id)
        .order('created_at', { ascending: false })
        .limit(1);

      const ticket = tickets?.[0];
      const meta = ticket ? parseTicketMeta(ticket) : {};
      const opMeta = account ? parseOperatorMeta(account) : {};
      const site = meta.site_key || opMeta.site_key || 'my';
      if (siteKey && siteKey !== 'all' && site !== siteKey) continue;

      const bind = proxyFromIp(account?.ips);
      const shot = meta.shot_proxy;
      rows.push({
        ...rev,
        ticket_id: ticket?.id,
        ticket_number: ticket?.ticket_number,
        site_key: site,
        account_name: account?.account_name,
        phone_number: account?.phone_number,
        channel: meta.channel || '—',
        device_name: account?.devices?.device_name || meta.device_name || '',
        link_code: meta.link_code,
        bind_proxy: bind,
        shot_proxy: shot,
        ip_match: proxyMatch(bind, shot),
      });
    }

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
