import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { assertTransition } from '../../lib/stateMachine.js';
import { parseOperatorMeta, mergeOperatorNotes } from '../../lib/accountMeta.js';
import { resolveHubOwner } from '../../lib/hubOperators.js';
import {
  parseTicketMeta, serializeTicketDescription, proxyFromIp, proxyMatch,
  statusFromStage, stageFromStatus, ticketBucket, resolveRejectReason,
  isPlaceholderRejectReason,
} from '../../lib/ticketMeta.js';
import { ACCOUNT_SELECT_TICKET } from '../../lib/accountSelect.js';
import {
  screenshotUrlsByReviewIds,
  uploadTicketScreenshot,
} from '../../lib/ticketScreenshots.js';
import { enrichAccountsIpEmbed, normalizeIpJoin } from '../../lib/accountEnrich.js';
import {
  parseDateRangeQuery, inDateRange, rangeEvalAt,
} from '../../lib/dateRange.js';
import {
  accountInBrandScope,
  profileBrandScope,
  resolveAccountBrand,
} from '../../lib/accountBrand.js';
import { accountInStaffScope, profileStaffScope } from '../../lib/accountStaff.js';
import { isBrandSharedAccount, resolveAccountType } from '../../lib/accountType.js';
import {
  appendAccountUsageEvent,
  assertSharedSessionCap,
  usageActorFromReq,
} from '../../lib/accountUsage.js';

const BACKLOG_MS = 30 * 60 * 1000;

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
  link_code: z.string().regex(/^\d{8}$/),
  shot_proxy: shotSchema,
  screenshot_base64: screenshotSchema,
});

const resubmitSchema = z.object({
  link_code: z.string().regex(/^\d{8}$/),
  shot_proxy: shotSchema,
  screenshot_base64: screenshotSchema,
});

const rejectSchema = z.object({
  reason: z.string().min(1).optional(),
});

function isReviewOnlyRequest(body) {
  return body?.review_only === true || body?.review_only === 'true';
}

function canActAsTicketBusiness(profile) {
  return profile?.role === 'business' || profile?.role === 'admin';
}

function canActAsTicketOperator(profile) {
  return profile?.role === 'operator' || profile?.role === 'admin';
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

async function loadAccountsByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select(ACCOUNT_SELECT_TICKET)
    .in('id', unique);
  if (error) throw error;
  const enriched = await enrichAccountsIpEmbed(data);
  return new Map((enriched || []).map((row) => [row.id, row]));
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

function ticketSubmittedAt(ticket, meta) {
  return meta.submitted_at || ticket.created_at;
}

function wasPendingAt(ticket, meta, evalAt) {
  const sub = new Date(ticketSubmittedAt(ticket, meta));
  if (Number.isNaN(sub.getTime()) || sub.getTime() > evalAt.getTime()) return false;
  if (ticket.delivery_stage === 'submitted') return true;
  const resolved = new Date(ticket.updated_at || ticket.created_at);
  return resolved.getTime() > evalAt.getTime();
}

function formatAvgMinutes(ms) {
  if (ms == null || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
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
    reject_reason: resolveRejectReason(meta),
    channel: meta.channel || opMeta.channel || '—',
    device_name: account?.devices?.device_name || meta.device_name || '—',
    account_name: accountName,
    owner: hubOwner,
    staff: String(opMeta.staff || '').trim(),
    account_type: resolveAccountType(account || { notes: '' }),
    customer_name: hubOwner,
    requester_name: requesterName || '',
    phone_number: account?.phone_number || account?.sims?.phone_number || '—',
    ip_gate_review_id: meta.ip_gate_review_id || null,
    screenshot_url: screenshotUrl,
    submitted_at: meta.submitted_at || ticket.created_at || null,
    in_progress_at: meta.in_progress_at || null,
    closed_at: meta.closed_at || ticket.closed_at || null,
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
  const extras = await screenshotUrlsByReviewIds(reviewIds);
  return rows.map((row) => {
    const extra = row.ip_gate_review_id ? extras.get(row.ip_gate_review_id) : null;
    const screenshot_url = extra?.screenshot_url || row.screenshot_url || null;
    const reject_reason = resolveRejectReason({
      ...row,
      review_note: extra?.review_note || row.review_note,
    });
    return {
      ...row,
      screenshot_url,
      reject_reason: reject_reason || row.reject_reason || '',
    };
  });
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
    const accountMap = await loadAccountsByIds((tickets || []).map((t) => t.account_id));
    const brandScope = profileBrandScope(req.profile);
    const staffScope = profileStaffScope(req.profile);
    const rows = [];
    for (const t of tickets || []) {
      const account = t.account_id ? (accountMap.get(t.account_id) || null) : null;
      const row = enrichRow(t, account, null, requesterMap.get(t.requester_id) || '');
      if (siteKey && siteKey !== 'all' && row.site_key !== siteKey) continue;
      if (!accountInBrandScope(account, brandScope)) continue;
      if (!accountInStaffScope(account || { staff: row.staff }, staffScope)) continue;
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
    const range = parseDateRangeQuery(req.query);
    const evalAt = rangeEvalAt(range);
    const { data: tickets } = await supabaseAdmin.from('tickets').select('*').limit(500);
    const requesterMap = await loadRequesterNameMap((tickets || []).map((t) => t.requester_id));
    const accountMap = await loadAccountsByIds((tickets || []).map((t) => t.account_id));
    const brandScope = profileBrandScope(req.profile);
    const staffScope = profileStaffScope(req.profile);
    const rows = [];
    for (const t of tickets || []) {
      const account = t.account_id ? (accountMap.get(t.account_id) || null) : null;
      const row = enrichRow(t, account, null, requesterMap.get(t.requester_id) || '');
      if (siteKey && siteKey !== 'all' && row.site_key !== siteKey) continue;
      if (!accountInBrandScope(account, brandScope)) continue;
      if (!accountInStaffScope(account || { staff: row.staff }, staffScope)) continue;
      rows.push(row);
    }

    const pendingRows = rows.filter((r) => {
      const meta = parseTicketMeta(r);
      return wasPendingAt(r, meta, evalAt);
    });
    const pending = pendingRows.length;

    const backlogOver30 = pendingRows.filter((r) => {
      const meta = parseTicketMeta(r);
      const sub = new Date(ticketSubmittedAt(r, meta));
      return (evalAt.getTime() - sub.getTime()) > BACKLOG_MS;
    }).length;

    const inProg = rows.filter((r) => r.delivery_stage === 'posted').length;
    const done = rows.filter((r) => {
      if (r.delivery_stage !== 'done') return false;
      return !range || inDateRange(r.updated_at, range);
    }).length;
    const rejected = rows.filter((r) => {
      if (!r.reject_reason) return false;
      return !range || inDateRange(r.updated_at, range);
    }).length;

    const handled = rows.filter((r) => {
      if (r.delivery_stage !== 'posted' && r.delivery_stage !== 'done') return false;
      return !range || inDateRange(r.updated_at, range);
    });
    const durations = handled.map((r) => {
      const meta = parseTicketMeta(r);
      const start = new Date(ticketSubmittedAt(r, meta));
      const end = new Date(r.updated_at || r.created_at);
      return end.getTime() - start.getTime();
    }).filter((ms) => ms > 0);
    const avgHandlingMs = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
    const avgHandlingTime = formatAvgMinutes(avgHandlingMs);

    const byReason = {};
    rows.filter((r) => r.reject_reason && (!range || inDateRange(r.updated_at, range))).forEach((r) => {
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
      backlogOver30,
      avgHandlingTime,
      rejectReasons: rejReasons,
      detail: `${pending} awaiting review · ${inProg} awaiting business confirm · ${done} completed`,
      date_range: range ? { from: range.from, to: range.to } : null,
      eval_at: evalAt.toISOString(),
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
    brand: resolveAccountBrand(account) || null,
    siteKey: inferSiteKey(meta, ip),
    owner: resolveHubOwner(account, meta) || '',
    staff: String(meta.staff || '').trim(),
    account_type: resolveAccountType(account),
    bind_proxy: proxyFromIp(ip),
    status: account.status,
  };
}

function canRequestDelivery(account) {
  if (!account) return false;
  const meta = parseOperatorMeta(account);
  if (meta.restrict_kind) return false;
  if (account.status === 'AVAILABLE' || account.status === 'LOGGED_OUT') return true;
  // Brand-shared: allow additional concurrent requests while already In Use (cap = 4).
  if (isBrandSharedAccount(account) && account.status === 'IN_USE') return true;
  return false;
}

// GET /tickets/standby-accounts — standby pool for new delivery tickets (must be before /:id routes)
router.get('/standby-accounts', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const brandScope = profileBrandScope(req.profile);
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select(ACCOUNT_SELECT_TICKET)
      .in('status', ['AVAILABLE', 'LOGGED_OUT', 'IN_USE'])
      .order('updated_at', { ascending: false })
      .limit(400);
    if (error) throw error;

    const enriched = await enrichAccountsIpEmbed(data);
    const staffScope = profileStaffScope(req.profile);
    const rows = enriched
      .filter((row) => canRequestDelivery(row))
      .map(standbyAccountRow)
      .filter((row) => !siteKey || siteKey === 'all' || row.siteKey === siteKey)
      .filter((row) => {
        if (!brandScope) return true;
        if (!brandScope.length) return false;
        return row.brand && brandScope.includes(row.brand);
      })
      .filter((row) => accountInStaffScope(row, staffScope));

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
    if (!canRequestDelivery(account)) {
      return res.status(400).json({
        error: isBrandSharedAccount(account)
          ? 'Account is not available for a Brand-shared scan request'
          : 'Account must be Standby or Logged out (not Restricted) to request a scan',
      });
    }
    const brandScope = profileBrandScope(req.profile);
    if (!accountInBrandScope(account, brandScope)) {
      return res.status(403).json({ error: 'Account brand is outside your assigned brands' });
    }
    if (!accountInStaffScope(account, profileStaffScope(req.profile))) {
      return res.status(403).json({ error: 'This account is assigned to another staff member' });
    }
    if (isBrandSharedAccount(account)) {
      try {
        await assertSharedSessionCap(account.id, { extraRequesterId: req.user.id });
      } catch (capErr) {
        if (capErr.status === 409) return res.status(409).json({ error: capErr.message });
        throw capErr;
      }
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
      submitted_at: new Date().toISOString(),
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

    if (isBrandSharedAccount(account)) {
      const actor = usageActorFromReq(req);
      await appendAccountUsageEvent({
        accountId: account.id,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'request',
        ticketId: ticket.id,
        metadata: { ticket_number: ticket.ticket_number },
      });
    }

    const [enriched] = await attachScreenshotUrls([
      enrichRow(ticket, account, null, requesterLabel(req, account)),
    ]);

    const standbyDays = (() => {
      const start = account.updated_at || account.created_at;
      const startMs = new Date(start).getTime();
      const now = Date.now();
      if (Number.isNaN(startMs) || now < startMs) return 1;
      return Math.max(1, Math.floor((now - startMs) / 86_400_000) + 1);
    })();
    const rescan = account.status === 'LOGGED_OUT';
    await supabaseAdmin.from('account_status_history').insert({
      account_id: account.id,
      from_status: account.status,
      to_status: account.status,
      reason: rescan
        ? `Delivery ticket #${ticket.ticket_number} submitted — re-scan after logout (awaiting IP review)`
        : `Delivery ticket #${ticket.ticket_number} submitted — awaiting IP review (business scan)${standbyDays ? ` · Standby so far ${standbyDays === 1 ? '1 day' : `${standbyDays} days`}` : ''}`,
      changed_by: req.profile?.id || req.user.id,
    });

    res.status(201).json(enriched);
  } catch (e) {
    next(e);
  }
});

// POST /tickets/:id/go-live — operator approves IP match and marks in use
router.post('/:id/go-live', async (req, res, next) => {
  try {
    if (!canActAsTicketOperator(req.profile)) {
      return res.status(403).json({ error: 'Operator or admin only' });
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
    if (isBrandSharedAccount(account)) {
      try {
        await assertSharedSessionCap(account.id, { extraRequesterId: ticket.requester_id });
      } catch (capErr) {
        if (capErr.status === 409) return res.status(409).json({ error: capErr.message });
        throw capErr;
      }
    }
    meta.delivery_stage = 'posted';
    meta.reject_reason = '';
    meta.in_progress_at = new Date().toISOString();

    if (meta.ip_gate_review_id) {
      await supabaseAdmin.from('ip_gate_reviews').update({
        status: 'APPROVED',
        reviewer_id: req.user.id,
        reviewed_at: new Date().toISOString(),
        review_note: 'IP screenshot matches bound proxy',
      }).eq('id', meta.ip_gate_review_id);
    }

    const alreadyInUse = account.status === 'IN_USE';
    if (!alreadyInUse) {
      assertTransition(account.status, 'IN_USE');
      const goLivePatch = { status: 'IN_USE' };
      if (account.status === 'LOGGED_OUT') {
        goLivePatch.notes = mergeOperatorNotes(account.notes, { disconnect_report: null });
        goLivePatch.wsaf_slot = null;
      }
      await supabaseAdmin.from('accounts').update(goLivePatch).eq('id', account.id);
    }

    const { data: standbyRows } = await supabaseAdmin
      .from('account_status_history')
      .select('changed_at')
      .eq('account_id', account.id)
      .eq('to_status', 'AVAILABLE')
      .order('changed_at', { ascending: false })
      .limit(1);
    const standbyRow = Array.isArray(standbyRows) ? standbyRows[0] : standbyRows;
    const standbyStart = standbyRow?.changed_at || account.updated_at || account.created_at;
    const standbyMs = new Date(standbyStart).getTime();
    const standbyDays = Number.isNaN(standbyMs)
      ? 1
      : Math.max(1, Math.floor((Date.now() - standbyMs) / 86_400_000) + 1);
    const fromStatus = account.status;
    const rescan = fromStatus === 'LOGGED_OUT';
    const dayLabel = standbyDays === 1 ? '1 day' : `${standbyDays} days`;
    const sharedExtra = alreadyInUse && isBrandSharedAccount(account);
    await supabaseAdmin.from('account_status_history').insert({
      account_id: account.id,
      from_status: fromStatus,
      to_status: 'IN_USE',
      reason: sharedExtra
        ? `Go-live ticket #${ticket.ticket_number} — additional Brand-shared session`
        : rescan
          ? `Go-live ticket #${ticket.ticket_number} — Logged out → In Use (re-scan)`
          : `Go-live ticket #${ticket.ticket_number} — Standby ${dayLabel} → In Use (business scan)`,
      changed_by: req.profile?.id || req.user.id,
    });

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
    if (!canActAsTicketOperator(req.profile)) {
      return res.status(403).json({ error: 'Operator or admin only' });
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
    if (!canActAsTicketOperator(req.profile)) {
      return res.status(403).json({ error: 'Operator or admin only' });
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

    const ticket = await loadTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const account = await tryLoadAccount(ticket.account_id);
    const meta = parseTicketMeta(ticket);
    const reason = isPlaceholderRejectReason(rejectReason)
      ? resolveRejectReason({ ...meta, delivery_stage: 'rejected', reject_reason: rejectReason })
      : String(rejectReason).trim();
    meta.reject_reason = reason;
    meta.delivery_stage = 'rejected';
    meta.closed_at = new Date().toISOString();

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
    if (!accountInStaffScope(account, profileStaffScope(req.profile))) {
      return res.status(403).json({ error: 'This ticket belongs to another staff member' });
    }

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
    meta.submitted_at = new Date().toISOString();
    meta.in_progress_at = undefined;
    meta.closed_at = undefined;
    meta.link_code = body.link_code;
    meta.shot_proxy = body.shot_proxy;
    meta.reject_reason = '';
    meta.review_match = undefined;
    meta.ip_gate_review_id = review?.id || meta.ip_gate_review_id;

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('tickets')
      .update({
        status: 'OPEN',
        closed_at: null,
        description: serializeTicketDescription('', meta),
      })
      .eq('id', ticket.id)
      .select('*')
      .single();
    if (upErr) throw upErr;

    const [enriched] = await attachScreenshotUrls([
      enrichRow(updated, account, null, requesterLabel(req, account)),
    ]);
    if (isBrandSharedAccount(account)) {
      const actor = usageActorFromReq(req);
      await appendAccountUsageEvent({
        accountId: account.id,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'request',
        ticketId: ticket.id,
        metadata: { ticket_number: ticket.ticket_number, resubmit: true },
      });
    }
    res.json(enriched);
  } catch (e) {
    next(e);
  }
});

// POST /tickets/:id/confirm — business confirms delivery complete
router.post('/:id/confirm', async (req, res, next) => {
  try {
    if (!canActAsTicketBusiness(req.profile)) {
      return res.status(403).json({ error: 'Business or admin only' });
    }
    const { data: ticket, error } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    const account = await loadAccount(ticket.account_id);
    if (!accountInStaffScope(account, profileStaffScope(req.profile))) {
      return res.status(403).json({ error: 'This ticket belongs to another staff member' });
    }
    const row = enrichRow(ticket, account);
    if (row.delivery_stage !== 'posted') {
      return res.status(400).json({ error: 'Ticket is not awaiting business confirmation' });
    }

    const meta = parseTicketMeta(ticket);
    meta.delivery_stage = 'done';
    meta.closed_at = new Date().toISOString();

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('tickets')
      .update({
        status: 'RESOLVED',
        closed_at: meta.closed_at,
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

    if (isBrandSharedAccount(account)) {
      const actor = usageActorFromReq(req);
      await appendAccountUsageEvent({
        accountId: account.id,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'confirm',
        ticketId: ticket.id,
        metadata: { ticket_number: ticket.ticket_number },
      });
    }

    res.json(enrichRow(updated, account, null, requesterLabel(req, account)));
  } catch (e) {
    next(e);
  }
});

export { enrichRow, ticketBucket, statusFromStage };
export default router;
