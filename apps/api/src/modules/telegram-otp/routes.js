import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import {
  OTP_REQUEST_TTL_MS,
  isAssignedAccount,
  isSessionReady,
  purgeOtpRequests,
} from './store.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator', 'business'));

const ACCOUNT_FIELDS = 'id, pool, phone, profile, brand, currency, owner, status, enabled, synced_at';

function publicRequest(row, account) {
  const visible = row.status === 'delivered' && row.code;
  return {
    id: row.id,
    account_id: row.account_id,
    account: account || null,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    delivered_at: row.delivered_at,
    logged_in_at: row.logged_in_at || null,
    code: visible ? row.code : null,
    password: visible ? row.password : null,
    has_password: visible ? Boolean(row.password) : false,
  };
}

async function loadAccount(id) {
  const { data, error } = await supabaseAdmin.from('tg_accounts').select(ACCOUNT_FIELDS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** GET /telegram-otp/accounts — accounts this user may request a code for. */
router.get('/accounts', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tg_accounts')
      .select(ACCOUNT_FIELDS)
      .eq('enabled', true)
      .order('id', { ascending: true });
    if (error) throw error;
    const rows = (data || []).filter((a) => isAssignedAccount(req.profile, a));
    const lastSync = (data || []).reduce((max, a) => (a.synced_at > max ? a.synced_at : max), '');
    res.json({ data: rows, last_synced_at: lastSync || null });
  } catch (e) {
    next(e);
  }
});

/** GET /telegram-otp/assignments — shooter owners and GCS brands in the roster (for User management). */
router.get('/assignments', requireRole('admin'), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tg_accounts')
      .select('pool, owner, brand')
      .eq('enabled', true);
    if (error) throw error;
    const distinct = (values) => [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))].sort();
    const rows = data || [];
    res.json({
      owners: distinct(rows.filter((r) => r.pool === 'shooter').map((r) => r.owner)),
      brands: distinct(rows.filter((r) => r.pool === 'gcs').map((r) => r.brand)),
    });
  } catch (e) {
    next(e);
  }
});

/** GET /telegram-otp/requests/active — this user's open or still-visible request, if any. */
router.get('/requests/active', async (req, res, next) => {
  try {
    await purgeOtpRequests();
    const { data, error } = await supabaseAdmin
      .from('otp_requests')
      .select('*')
      .eq('requested_by', req.profile.id)
      .in('status', ['pending', 'delivered'])
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.json({ data: null });
    res.json({ data: publicRequest(data, await loadAccount(data.account_id)) });
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({ account_id: z.string().trim().min(1).max(120) });

/** POST /telegram-otp/requests — open a 5-minute window for this account's next login code. */
router.post('/requests', async (req, res, next) => {
  try {
    const { account_id: accountId } = createSchema.parse(req.body);
    const account = await loadAccount(accountId);
    if (!account || !account.enabled) return res.status(404).json({ error: 'Telegram account not found' });
    if (!isAssignedAccount(req.profile, account)) {
      return res.status(403).json({ error: 'This account is not assigned to you' });
    }
    if (!isSessionReady(account)) {
      return res.status(409).json({
        error: `This account is ${account.status || 'not ready'} in the Telegram bot — it cannot receive login codes until its status is Ready.`,
      });
    }

    await purgeOtpRequests();
    const nowIso = new Date().toISOString();
    const { data: open, error: openErr } = await supabaseAdmin
      .from('otp_requests')
      .select('*, profiles:requested_by (full_name, username)')
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openErr) throw openErr;
    if (open && open.requested_by === req.profile.id) {
      return res.json(publicRequest(open, account));
    }
    if (open) {
      const who = open.profiles?.full_name || open.profiles?.username || 'Someone';
      return res.status(409).json({ error: `${who} is already logging in to this account. Try again in a few minutes.` });
    }

    await supabaseAdmin
      .from('otp_requests')
      .update({ status: 'cancelled' })
      .eq('requested_by', req.profile.id)
      .eq('status', 'pending');

    const { data: created, error } = await supabaseAdmin
      .from('otp_requests')
      .insert({
        account_id: accountId,
        requested_by: req.profile.id,
        expires_at: new Date(Date.now() + OTP_REQUEST_TTL_MS).toISOString(),
      })
      .select('*')
      .single();
    if (error) throw error;

    await writeAudit({
      entityType: 'tg_account',
      entityId: accountId,
      action: 'OTP_REQUEST',
      newValue: { account_id: accountId, pool: account.pool, owner: account.owner },
      metadata: { request_id: created.id },
      userId: req.profile.id,
      req,
    });
    res.status(201).json(publicRequest(created, account));
  } catch (e) {
    next(e);
  }
});

async function loadOwnRequest(req, res) {
  const { data, error } = await supabaseAdmin
    .from('otp_requests')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.requested_by !== req.profile.id) {
    res.status(404).json({ error: 'Request not found' });
    return null;
  }
  return data;
}

/** GET /telegram-otp/requests/:id — poll for the code. */
router.get('/requests/:id', async (req, res, next) => {
  try {
    await purgeOtpRequests();
    const row = await loadOwnRequest(req, res);
    if (!row) return;
    res.json(publicRequest(row, await loadAccount(row.account_id)));
  } catch (e) {
    next(e);
  }
});

/** POST /telegram-otp/requests/:id/cancel — close a pending request or hide a delivered code. */
router.post('/requests/:id/cancel', async (req, res, next) => {
  try {
    const row = await loadOwnRequest(req, res);
    if (!row) return;
    const patch = row.status === 'pending'
      ? { status: 'cancelled' }
      : { code: null, password: null, expires_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin
      .from('otp_requests')
      .update(patch)
      .eq('id', row.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(publicRequest(data, null));
  } catch (e) {
    next(e);
  }
});

export default router;
