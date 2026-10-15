import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import {
  purgeGroupScans,
  purgeOtpRequests,
  LOGIN_CONFIRM_WINDOW_MS,
  LOGIN_SUCCESS_VISIBLE_MS,
  OTP_VIEW_WINDOW_MS,
} from './store.js';

/**
 * Server-to-server API for the TG-OTP listener (Railway). It sits outside the company-network
 * allowlist because Railway is not on the VPN, so it is gated by TG_OTP_SERVICE_TOKEN instead.
 */
const router = Router();

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function requireServiceToken(req, res, next) {
  const expected = process.env.TG_OTP_SERVICE_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Telegram OTP service is not configured' });
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !crypto.timingSafeEqual(digest(given), digest(expected))) {
    return res.status(401).json({ error: 'Invalid service token' });
  }
  next();
}

router.use(requireServiceToken);

const accountSchema = z.object({
  id: z.string().trim().min(1).max(120),
  pool: z.enum(['gcs', 'shooter']),
  phone: z.string().trim().max(40).optional().nullable(),
  profile: z.string().trim().max(200).optional().nullable(),
  brand: z.string().trim().max(40).optional().nullable(),
  currency: z.string().trim().max(10).optional().nullable(),
  owner: z.string().trim().max(80).optional().nullable(),
  status: z.string().trim().max(40).optional().nullable(),
  enabled: z.boolean().optional(),
});

const syncSchema = z.object({ accounts: z.array(accountSchema).max(5000) });

/** POST /accounts/sync — full roster; accounts missing from the list are disabled. */
router.post('/accounts/sync', async (req, res, next) => {
  try {
    const { accounts } = syncSchema.parse(req.body);
    if (!accounts.length) return res.status(400).json({ error: 'Refusing to sync an empty roster' });
    const now = new Date().toISOString();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const rows = [...byId.values()].map((a) => ({
      id: a.id,
      pool: a.pool,
      phone: a.phone || null,
      profile: a.profile || null,
      brand: a.brand || null,
      currency: a.currency || null,
      owner: a.owner || null,
      status: a.status || null,
      enabled: a.enabled !== false,
      synced_at: now,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabaseAdmin.from('tg_accounts').upsert(rows.slice(i, i + 500));
      if (error) throw error;
    }
    const { error: offErr } = await supabaseAdmin
      .from('tg_accounts')
      .update({ enabled: false })
      .lt('synced_at', now)
      .eq('enabled', true);
    if (offErr) throw offErr;
    res.json({ synced: rows.length });
  } catch (e) {
    next(e);
  }
});

const deliverSchema = z.object({
  account_id: z.string().trim().min(1).max(120),
  code: z.string().trim().regex(/^\d{4,8}$/),
  password: z.string().max(200).optional().nullable(),
});

/**
 * POST /deliver — called for every login code the listener catches. Stored only when an AMS
 * user has an open request for that account; otherwise the listener keeps its own bot flow.
 */
router.post('/deliver', async (req, res, next) => {
  try {
    const body = deliverSchema.parse(req.body);
    await purgeOtpRequests();
    const { data: open, error } = await supabaseAdmin
      .from('otp_requests')
      .select('id, requested_by')
      .eq('account_id', body.account_id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!open) return res.json({ delivered: false });

    const now = Date.now();
    const { error: upErr } = await supabaseAdmin
      .from('otp_requests')
      .update({
        status: 'delivered',
        code: body.code,
        password: body.password || null,
        delivered_at: new Date(now).toISOString(),
        expires_at: new Date(now + OTP_VIEW_WINDOW_MS).toISOString(),
      })
      .eq('id', open.id)
      .eq('status', 'pending');
    if (upErr) throw upErr;

    await writeAudit({
      entityType: 'tg_account',
      entityId: body.account_id,
      action: 'OTP_DELIVERED',
      metadata: { request_id: open.id, source: 'tg-otp-listener' },
      userId: open.requested_by,
    });
    res.json({ delivered: true });
  } catch (e) {
    next(e);
  }
});

const loginConfirmedSchema = z.object({
  account_id: z.string().trim().min(1).max(120),
  device: z.string().trim().max(200).optional().nullable(),
});

/**
 * POST /login-confirmed — the listener saw a new device sign in after a code was delivered.
 * The code and password are wiped right away; the request stays readable briefly so the
 * requester's dialog can show the success state.
 */
router.post('/login-confirmed', async (req, res, next) => {
  try {
    const body = loginConfirmedSchema.parse(req.body);
    const since = new Date(Date.now() - LOGIN_CONFIRM_WINDOW_MS).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from('otp_requests')
      .select('id, requested_by')
      .eq('account_id', body.account_id)
      .eq('status', 'delivered')
      .is('logged_in_at', null)
      .gt('delivered_at', since)
      .order('delivered_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.json({ confirmed: false });

    const now = Date.now();
    const { error: upErr } = await supabaseAdmin
      .from('otp_requests')
      .update({
        logged_in_at: new Date(now).toISOString(),
        code: null,
        password: null,
        expires_at: new Date(now + LOGIN_SUCCESS_VISIBLE_MS).toISOString(),
      })
      .eq('id', row.id)
      .is('logged_in_at', null);
    if (upErr) throw upErr;

    await writeAudit({
      entityType: 'tg_account',
      entityId: body.account_id,
      action: 'OTP_LOGIN_CONFIRMED',
      metadata: { request_id: row.id, device: body.device || null, source: 'tg-otp-listener' },
      userId: row.requested_by,
    });
    res.json({ confirmed: true });
  } catch (e) {
    next(e);
  }
});

/** POST /group-scans/next — claim the oldest queued group scan, if any. */
router.post('/group-scans/next', async (_req, res, next) => {
  try {
    await purgeGroupScans();
    const { data: queued, error } = await supabaseAdmin
      .from('tg_group_scans')
      .select('id, account_id')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!queued) return res.json({ scan: null });

    const now = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('tg_group_scans')
      .update({ status: 'running', started_at: now, heartbeat_at: now })
      .eq('id', queued.id)
      .eq('status', 'queued')
      .select('id, account_id')
      .maybeSingle();
    if (claimErr) throw claimErr;
    res.json({ scan: claimed || null });
  } catch (e) {
    next(e);
  }
});

const scanProgressSchema = z.object({
  done: z.number().int().min(0).max(100000),
  total: z.number().int().min(0).max(100000).nullable().optional(),
});

/** POST /group-scans/:id/progress — heartbeat; tells the listener to stop when the scan was cancelled. */
router.post('/group-scans/:id/progress', async (req, res, next) => {
  try {
    const body = scanProgressSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('tg_group_scans')
      .update({
        progress_done: body.done,
        ...(body.total != null ? { progress_total: body.total } : {}),
        heartbeat_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('status', 'running')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    res.json({ keep_going: Boolean(data) });
  } catch (e) {
    next(e);
  }
});

const scannedGroupSchema = z.object({
  group_id: z.string().trim().min(1).max(40),
  group_name: z.string().max(255).optional().nullable(),
  member_count: z.number().int().min(0).max(10000000).optional().nullable(),
  is_admin: z.boolean().optional(),
  is_owner: z.boolean().optional(),
  invite_link: z.string().trim().max(300).optional().nullable(),
});

const scanResultSchema = z.object({ groups: z.array(scannedGroupSchema).max(10000) });

/** POST /group-scans/:id/result — the complete group list; replaces the account's previous list. */
router.post('/group-scans/:id/result', async (req, res, next) => {
  try {
    const { groups } = scanResultSchema.parse(req.body);
    const { data: scan, error: scanErr } = await supabaseAdmin
      .from('tg_group_scans')
      .select('id, account_id, requested_by, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (scanErr) throw scanErr;
    if (!scan || scan.status !== 'running') return res.status(409).json({ error: 'Scan is not running' });

    const { data: count, error } = await supabaseAdmin.rpc('tg_commit_group_scan', {
      p_scan_id: scan.id,
      p_groups: groups,
    });
    if (error) throw error;

    await writeAudit({
      entityType: 'tg_account',
      entityId: scan.account_id,
      action: 'TG_GROUP_SCAN',
      newValue: {
        groups: count,
        admin: groups.filter((g) => g.is_admin || g.is_owner).length,
      },
      metadata: { scan_id: scan.id, source: 'tg-otp-listener' },
      userId: scan.requested_by,
    });
    res.json({ committed: count });
  } catch (e) {
    next(e);
  }
});

const scanFailSchema = z.object({ error: z.string().trim().min(1).max(500) });

/** POST /group-scans/:id/fail — the listener could not finish; the previous group list stays. */
router.post('/group-scans/:id/fail', async (req, res, next) => {
  try {
    const body = scanFailSchema.parse(req.body);
    const { error } = await supabaseAdmin
      .from('tg_group_scans')
      .update({ status: 'failed', error: body.error, finished_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('status', 'running');
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
