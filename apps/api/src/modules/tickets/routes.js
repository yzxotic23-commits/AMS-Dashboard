import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { assertTransition } from '../../lib/stateMachine.js';
import { parseOperatorMeta } from '../../lib/accountMeta.js';
import { resolveHubOwner } from '../../lib/hubOperators.js';
import {
  parseTicketMeta, serializeTicketDescription, proxyFromIp, proxyMatch,
  statusFromStage, stageFromStatus, ticketBucket,
} from '../../lib/ticketMeta.js';
import { ACCOUNT_SELECT_TICKET } from '../../lib/accountSelect.js';
import {
  screenshotUrlsByReviewIds,
  uploadTicketScreenshot,
} from '../../lib/ticketScreenshots.js';
import { enrichAccountsIpEmbed, normalizeIpJoin } from '../../lib/accountEnrich.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator', 'business'));

const shotSchema = z.object({
  ip_address: z.string().min(1),
  port: z.string().min(1),
  username: z.string(),
  password: z.string(),
});

const screenshotSchema = z.string().min(32).refine(
  (value) => /^data:image\/(?:jpeg|png|webp);base64,/i.test(value),
  'Screenshot image required (JPEG, PNG, or WebP)',
);

const createSchema = z.object({
  account_id: z.string().uuid(),
  link_code: z.string().regex(/^\d{6}$/),
  shot_proxy: shotSchema,
  screenshot_base64: screenshotSchema,
});

const resubmitSchema = z.object({
  link_code: z.string().regex(/^\d{6}$/),
  shot_proxy: shotSchema,
  screenshot_base64: screenshotSchema,
});

const rejectSchema = z.object({
  reason: z.string().min(1).optional(),
});

function isReviewOnlyRequest(body) {
  return body?.review_only === true || body?.review_only === 'true';
}

async function loadAccount(accountId) {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select(ACCOUNT_SELECT_TICKET)
    .eq('id', accountId)
    .single();
  if (error) throw error;
  return data;
}

async function tryLoadAccount(accountId) {
  if (!accountId) return null;
  try {
    return await loadAccount(accountId);
  } catch {
    return null;
  }
}

async function loadTicketById(id) {
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveTicketReview({ ticketId, match, userId, req }) {
  const ticket = await loadTicketById(ticketId);
  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }
  const account = await tryLoadAccount(ticket.account_id);
  const meta = parseTicketMeta(ticket);
  if (meta.delivery_stage !== 'submitted') {
    const err = new Error('Ticket is not awaiting review');
    err.status = 400;
    throw err;
  }
  meta.review_match = Boolean(match);

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('tickets')
    .update({ description: serializeTicketDescription('', meta) })
    .eq('id', ticket.id)
    .select('*')
    .single();
  if (upErr) throw upErr;

  await writeAudit({
    entityType: 'ip_gate',
    entityId: meta.ip_gate_review_id || ticket.id,
    action: 'TICKET_UPDATE',
    metadata: {
      review: match ? 'IP_REVIEW_MATCH' : 'IP_REVIEW_MISMATCH',
      match: Boolean(match),
      ticket_id: ticket.id,
    },
    userId,
    req,
  });

  let requesterName = '';
  if (ticket.requester_id) {
    const map = await loadRequesterNameMap([ticket.requester_id]);
    requesterName = map.get(ticket.requester_id) || '';
  }
  const [enriched] = await attachScreenshotUrls([enrichRow(updated, account, null, requesterName)]);
  return enriched;
}

function enrichRow(ticket, account, screenshotUrl = null, requesterName = '') {
  const meta = parseTicketMeta(ticket);
  const opMeta = account ? parseOperatorMeta(account) : {};
  const bind = proxyFromIp(account?.ips);
  const shot = meta.shot_proxy || null;
  const delivery_stage = meta.delivery_stage || stageFromStatus(ticket.status);
  const accountName = account?.account_name || '—';
  const hubOwner = account ? resolveHubOwner(account, opMeta) : '';
  return {
    ...ticket,
    delivery_stage,
    site_key: meta.site_key || opMeta.site_key || 'my',
    link_code: meta.link_code || '',
    shot_proxy: shot,
    bind_proxy: bind,
    review_match: meta.review_match ?? null,
    ip_match: meta.review_match ?? null,
    reject_reason: meta.reject_reason || '',
    channel: meta.channel || opMeta.channel || '—',
    device_name: account?.devices?.device_name || meta.device_name || '—',
    account_name: accountName,
    owner: hubOwner,
    customer_name: hubOwner,
    requester_name: requesterName || '',
    phone_number: account?.phone_number || account?.sims?.phone_number || '—',
    ip_gate_review_id: meta.ip_gate_review_id || null,
    screenshot_url: screenshotUrl,
  };
}

function requesterLabel(req, account) {
  const opMeta = account ? parseOperatorMeta(account) : {};
  return opMeta.owner || req.profile?.full_name || req.profile?.username || '';
}

async function loadRequesterNameMap(requesterIds) {
  const ids = [...new Set(requesterIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, username')
    .in('id', ids);
  if (error) throw error;
  const map = new Map();
  (data || []).forEach((p) => {
    map.set(p.id, p.full_name || p.username || '');
  });
  return map;
}

async function attachScreenshotUrls(rows) {
  const reviewIds = rows.map((r) => r.ip_gate_review_id).filter(Boolean);
  const urlMap = await screenshotUrlsByReviewIds(reviewIds);
  return rows.map((row) => (
    row.ip_gate_review_id && urlMap.has(row.ip_gate_review_id)
      ? { ...row, screenshot_url: urlMap.get(row.ip_gate_review_id) }
      : row
  ));
}

async function saveReviewScreenshot({ accountId, reviewId, dataUrl }) {
  const path = await uploadTicketScreenshot({ accountId, reviewId, dataUrl });
  const { error } = await supabaseAdmin
    .from('ip_gate_reviews')
    .update({ phone_ip_screenshot_url: path })
    .eq('id', reviewId);
  if (error) throw error;
  return path;
}

// GET /tickets
router.get('/', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const { data: tickets, error } = await supabaseAdmin
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const requesterMap = await loadRequesterNameMap((tickets || []).map((t) => t.requester_id));
    const rows = [];
    for (const t of tickets || []) {
      let account = null;
      if (t.account_id) {
        try { account = await loadAccount(t.account_id); } catch { /* account removed */ }
      }
      const row = enrichRow(t, account, null, requesterMap.get(t.requester_id) || '');
      if (siteKey && siteKey !== 'all' && row.site_key !== siteKey) continue;
      rows.push(row);
    }
    res.json({ data: await attachScreenshotUrls(rows) });
  } catch (e) {
    next(e);
  }
});

// GET /tickets/stats
router.get('/stats', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const { data: tickets } = await supabaseAdmin.from('tickets').select('*').limit(200);
    const requesterMap = await loadRequesterNameMap((tickets || []).map((t) => t.requester_id));
    const rows = [];
    for (const t of tickets || []) {
      let account = null;
      if (t.account_id) {
        try { account = await loadAccount(t.account_id); } catch { /* skip */ }
      }
      const row = enrichRow(t, account, null, requesterMap.get(t.requester_id) || '');
      if (siteKey && siteKey !== 'all' && row.site_key !== siteKey) continue;
      rows.push(row);
    }

    const pending = rows.filter((r) => r.delivery_stage === 'submitted').length;
    const inProg = rows.filter((r) => r.delivery_stage === 'posted').length;
    const done = rows.filter((r) => r.delivery_stage === 'done').length;
    const rejected = rows.filter((r) => r.reject_reason).length;

    const byReason = {};
    rows.filter((r) => r.reject_reason).forEach((r) => {
      const label = r.reject_reason || 'IP mismatch';
      byReason[label] = (byReason[label] || 0) + 1;
    });
    const reasonTotal = rejected || 1;
    const rejReasons = Object.entries(byReason).map(([label, count]) => ({
      label,
      count,
      pct: Math.round((count / reasonTotal) * 100),
    }));

    res.json({
      pending,
      inProgress: inProg,
      done,
      rejected,
      tkPending: pending,
      tkDone: done,
      tkReject: rejected,
      rejectReasons: rejReasons,
      detail: `${pending} awaiting review · ${inProg} awaiting business confirm · ${done} completed`,
    });
  } catch (e) {
    next(e);
  }
});

function inferSiteKey(meta, ipRow) {
  if (meta.site_key) return meta.site_key;
  if (ipRow?.country === 'MY') return 'my';
  if (ipRow?.country === 'PP' || ipRow?.country === 'KH') return 'pp';
  const ip = String(ipRow?.ip_address || '');
  if (ip.startsWith('103.') || ip.startsWith('45.')) return 'my';
  if (ip.startsWith('175.') || ip.startsWith('192.')) return 'pp';
  return 'my';
}

function formatSimLabel(simRow) {
  if (!simRow?.phone_number) return '';
  return `${simRow.carrier || 'SIM'} · ${simRow.phone_number}`;
}

function standbyAccountRow(account) {
  const meta = parseOperatorMeta(account);
  const ip = normalizeIpJoin(account.ips);
  return {
    id: account.id,
    account_name: account.account_name,
    phone_number: account.phone_number || account.sims?.phone_number || '',
    sim: formatSimLabel(account.sims),
    siteKey: inferSiteKey(meta, ip),
    bind_proxy: proxyFromIp(ip),
  };
}

// GET /tickets/standby-accounts — standby pool for new delivery tickets (must be before /:id routes)
router.get('/standby-accounts', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select(ACCOUNT_SELECT_TICKET)
      .eq('status', 'AVAILABLE')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const enriched = await enrichAccountsIpEmbed(data);
    const rows = enriched
      .map(standbyAccountRow)
      .filter((row) => !siteKey || siteKey === 'all' || row.siteKey === siteKey);

    res.set('Cache-Control', 'no-store');
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// POST /tickets — business submits delivery request
router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const account = await loadAccount(body.account_id);
    if (account.status !== 'AVAILABLE') {
      return res.status(400).json({ error: 'Account must be in Standby (AVAILABLE) pool' });
    }
    const opMeta = parseOperatorMeta(account);
    const hubOwner = resolveHubOwner(account, opMeta);
    const customerLabel = hubOwner || account.account_name;

    const { data: review, error: revErr } = await supabaseAdmin
      .from('ip_gate_reviews')
      .insert({
        account_id: body.account_id,
        status: 'PENDING',
        submitted_by: req.user.id,
        phone_ip_screenshot_url: null,
      })
      .select('*')
      .single();
    if (revErr) throw revErr;

    try {
      await saveReviewScreenshot({
        accountId: body.account_id,
        reviewId: review.id,
        dataUrl: body.screenshot_base64,
      });
    } catch (uploadErr) {
      await supabaseAdmin.from('ip_gate_reviews').delete().eq('id', review.id);
      throw uploadErr;
    }

    const meta = {
      site_key: opMeta.site_key || 'my',
      delivery_stage: 'submitted',
      link_code: body.link_code,
      shot_proxy: body.shot_proxy,
      channel: opMeta.channel || 'WS Normal',
      device_name: account.devices?.device_name || '',
      ip_gate_review_id: review.id,
      reject_reason: '',
    };

    const { data: ticket, error } = await supabaseAdmin
      .from('tickets')
      .insert({
        title: `Delivery — ${customerLabel} · ${account.account_name}`,
        description: serializeTicketDescription('', meta),
        status: 'OPEN',
        requester_id: req.user.id,
        account_id: body.account_id,
      })
      .select('*')
      .single();
    if (error) throw error;

    await writeAudit({
      entityType: 'ticket',
      entityId: ticket.id,
      action: 'TICKET_CREATE',
      newValue: ticket,
      userId: req.user.id,
      req,
    });

    const [enriched] = await attachScreenshotUrls([
      enrichRow(ticket, account, null, requesterLabel(req, account)),
    ]);
    res.status(201).json(enriched);
  } catch (e) {
    next(e);
  }
});

// POST /tickets/:id/go-live — operator approves IP match and marks in use
router.post('/:id/go-live', async (req, res, next) => {
  try {
    if (req.profile.role !== 'operator') {
      return res.status(403).json({ error: 'Operator only' });
    }
    const ticket = await loadTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const account = await tryLoadAccount(ticket.account_id);
    if (!account) return res.status(404).json({ error: 'Account not found for this ticket' });
    const meta = parseTicketMeta(ticket);
    const row = enrichRow(ticket, account);
    if (row.delivery_stage !== 'submitted') {
      return res.status(400).json({ error: 'Ticket is not awaiting review' });
    }
    if (meta.review_match !== true) {
      return res.status(400).json({ error: 'Mark IP as match before go-live' });
    }
    meta.delivery_stage = 'posted';
    meta.reject_reason = '';

    if (meta.ip_gate_review_id) {
      await supabaseAdmin.from('ip_gate_reviews').update({
        status: 'APPROVED',
        reviewer_id: req.user.id,
        reviewed_at: new Date().toISOString(),
        review_note: 'IP screenshot matches bound proxy',
      }).eq('id', meta.ip_gate_review_id);
    }

    assertTransition(account.status, 'IN_USE');
    await supabaseAdmin.from('accounts').update({ status: 'IN_USE' }).eq('id', account.id);

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('tickets')
      .update({
        status: 'IN_PROGRESS',
        assignee_id: req.user.id,
        description: serializeTicketDescription('', meta),
      })
      .eq('id', ticket.id)
      .select('*')
      .single();
    if (upErr) throw upErr;

    await writeAudit({
      entityType: 'ip_gate',
      entityId: meta.ip_gate_review_id,
      action: 'IP_GATE_APPROVE',
      userId: req.user.id,
      req,
    });

    res.json(enrichRow(updated, { ...account, status: 'IN_USE' }, null, requesterLabel(req, account)));
  } catch (e) {
    next(e);
  }
});

// POST /tickets/:id/review-ip — operator marks screenshot match / mismatch (requires API reload after deploy)
router.post('/:id/review-ip', async (req, res, next) => {
  try {
    if (req.profile.role !== 'operator') {
      return res.status(403).json({ error: 'Operator only' });
    }
    const match = z.object({ match: z.boolean() }).parse(req.body).match;
    const enriched = await saveTicketReview({
      ticketId: req.params.id,
      match,
      userId: req.user.id,
      req,
    });
    res.json(enriched);
  } catch (e) {
    next(e);
  }
});

// POST /tickets/:id/reject — reject ticket OR review-only (review_only + match)
router.post('/:id/reject', async (req, res, next) => {
  try {
    if (req.profile.role !== 'operator') {
      return res.status(403).json({ error: 'Operator only' });
    }

    if (isReviewOnlyRequest(req.body)) {
      const match = z.object({ match: z.boolean() }).parse(req.body).match;
      const enriched = await saveTicketReview({
        ticketId: req.params.id,
        match,
        userId: req.user.id,
        req,
      });
      return res.json(enriched);
    }

    const { reason: rejectReason } = rejectSchema.parse(req.body);
    const reason = rejectReason || 'IP mismatch — resubmit with correct proxy screenshot';

    const ticket = await loadTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const account = await tryLoadAccount(ticket.account_id);
    const meta = parseTicketMeta(ticket);
    meta.reject_reason = reason;
    meta.delivery_stage = 'rejected';

    if (meta.ip_gate_review_id) {
      await supabaseAdmin.from('ip_gate_reviews').update({
        status: 'REJECTED',
        reviewer_id: req.user.id,
        reviewed_at: new Date().toISOString(),
        review_note: reason,
      }).eq('id', meta.ip_gate_review_id);
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('tickets')
      .update({
        description: serializeTicketDescription('', meta),
      })
      .eq('id', ticket.id)
      .select('*')
      .single();
    if (upErr) throw upErr;

    await writeAudit({
      entityType: 'ip_gate',
      entityId: meta.ip_gate_review_id,
      action: 'IP_GATE_REJECT',
      metadata: { reason },
      userId: req.user.id,
      req,
    });

    res.json(enrichRow(updated, account, null, requesterLabel(req, account)));
  } catch (e) {
    next(e);
  }
});

// POST /tickets/:id/resubmit
router.post('/:id/resubmit', async (req, res, next) => {
  try {
    const body = resubmitSchema.parse(req.body);
    const { data: ticket, error } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    const account = await loadAccount(ticket.account_id);

    const { data: review, error: revErr } = await supabaseAdmin
      .from('ip_gate_reviews')
      .insert({
        account_id: ticket.account_id,
        status: 'PENDING',
        submitted_by: req.user.id,
        phone_ip_screenshot_url: null,
      })
      .select('*')
      .single();
    if (revErr) throw revErr;

    try {
      await saveReviewScreenshot({
        accountId: ticket.account_id,
        reviewId: review.id,
        dataUrl: body.screenshot_base64,
      });
    } catch (uploadErr) {
      await supabaseAdmin.from('ip_gate_reviews').delete().eq('id', review.id);
      throw uploadErr;
    }

    const meta = parseTicketMeta(ticket);
    meta.delivery_stage = 'submitted';
    meta.link_code = body.link_code;
    meta.shot_proxy = body.shot_proxy;
    meta.reject_reason = '';
    meta.review_match = undefined;
    meta.ip_gate_review_id = review?.id || meta.ip_gate_review_id;

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('tickets')
      .update({
        status: 'OPEN',
        description: serializeTicketDescription('', meta),
      })
      .eq('id', ticket.id)
      .select('*')
      .single();
    if (upErr) throw upErr;

    const [enriched] = await attachScreenshotUrls([
      enrichRow(updated, account, null, requesterLabel(req, account)),
    ]);
    res.json(enriched);
  } catch (e) {
    next(e);
  }
});

// POST /tickets/:id/confirm — business confirms delivery complete
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const { data: ticket, error } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    const account = await loadAccount(ticket.account_id);
    const row = enrichRow(ticket, account);
    if (row.delivery_stage !== 'posted') {
      return res.status(400).json({ error: 'Ticket is not awaiting business confirmation' });
    }

    const meta = parseTicketMeta(ticket);
    meta.delivery_stage = 'done';

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('tickets')
      .update({
        status: 'RESOLVED',
        closed_at: new Date().toISOString(),
        description: serializeTicketDescription('', meta),
      })
      .eq('id', ticket.id)
      .select('*')
      .single();
    if (upErr) throw upErr;

    await writeAudit({
      entityType: 'ticket',
      entityId: ticket.id,
      action: 'TICKET_UPDATE',
      metadata: { delivery_stage: 'done' },
      userId: req.user.id,
      req,
    });

    res.json(enrichRow(updated, account, null, requesterLabel(req, account)));
  } catch (e) {
    next(e);
  }
});

export { enrichRow, ticketBucket, statusFromStage };
export default router;
