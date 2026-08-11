import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { assertTransition, ACCOUNT_STATUSES } from '../../lib/stateMachine.js';
import { parsePagination, paginatedResponse, pick } from '../../lib/pagination.js';
import {
  syncResourceBindings, recordInitialAssignments, bumpIpRisk, promoteSimToLedger,
} from '../../lib/resourceBindings.js';
import { serializeRecoveryNotes, recoveryOnBanDefaults } from '../../lib/accountRecovery.js';
import {
  ACCOUNT_SELECT,
  ACCOUNT_SELECT_FULL,
  ACCOUNT_SELECT_WITH_SIM_LOCATION,
} from '../../lib/accountSelect.js';
import { enrichAccountsIpEmbed } from '../../lib/accountEnrich.js';
import { parseOperatorMeta, mergeOperatorNotes } from '../../lib/accountMeta.js';
import { assertDeviceSlotAvailable, DeviceSlotError } from '../../lib/deviceSlots.js';
import { postWsafAuditRecord } from '../../lib/wsafBridge.js';
import { accountInBrandScope, profileBrandScope } from '../../lib/accountBrand.js';
import { parseTicketMeta } from '../../lib/ticketMeta.js';

const router = Router();
router.use(authenticate);
router.use((req, res, next) => {
  // Business is read-only except for self-reporting a disconnect (the one write action
  // they need so R&M finds out without a WhatsApp group message first).
  if (req.method === 'GET') {
    return requireRole('admin', 'operator', 'business')(req, res, next);
  }
  if (req.method === 'POST' && /\/report-disconnect$/.test(req.path)) {
    return requireRole('admin', 'operator', 'business')(req, res, next);
  }
  return requireRole('admin', 'operator')(req, res, next);
});

/** Strip proxy login credentials before a business profile ever sees the payload. */
function redactIpCredentials(row) {
  if (!row?.ips) return row;
  const ips = Array.isArray(row.ips) ? row.ips[0] : row.ips;
  if (!ips) return row;
  const { username, password, ...safeIp } = ips;
  return { ...row, ips: safeIp };
}

function sanitizeAccountsForRole(rows, profile) {
  if (profile?.role !== 'business') return rows;
  return (rows || []).map(redactIpCredentials);
}

/**
 * Business only sees accounts whose delivery ticket has reached "done" (business already
 * confirmed receipt) — never the internal Registering/Nurturing/Standby pool, and not even
 * "posted" (go-live, awaiting business confirm) yet, even if it happens to share their brand.
 * Statuses reachable only pre-delivery are hidden outright; the rest still need real ticket proof
 * (an account can cycle back to Nurturing/Standby for re-delivery and shouldn't stay visible).
 */
const BUSINESS_VISIBLE_STATUSES = new Set(['IN_USE', 'LOGGED_OUT', 'BANNED', 'RECOVERING']);

async function deliveredAccountIds(accountIds) {
  const ids = new Set();
  if (!accountIds.length) return ids;
  const { data: tix, error } = await supabaseAdmin
    .from('tickets')
    .select('account_id, status, description')
    .in('account_id', accountIds);
  if (error) throw error;
  (tix || []).forEach((t) => {
    if (!t.account_id) return;
    const stage = parseTicketMeta(t).delivery_stage;
    if (stage === 'done') ids.add(t.account_id);
  });
  return ids;
}

async function filterDeliveredForBusiness(rows, profile) {
  if (profile?.role !== 'business') return rows;
  const candidates = rows.filter((r) => BUSINESS_VISIBLE_STATUSES.has(r.status));
  const delivered = await deliveredAccountIds(candidates.map((r) => r.id));
  return candidates.filter((r) => delivered.has(r.id));
}

const createSchema = z.object({
  account_name: z.string().min(1),
  phone_number: z.string().optional().nullable(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  device_id: z.string().uuid().optional().nullable(),
  sim_id: z.string().uuid().optional().nullable(),
  ip_id: z.string().uuid().optional().nullable(),
  wsaf_slot: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

const transitionSchema = z.object({
  to_status: z.enum(ACCOUNT_STATUSES),
  reason: z.string().optional(),
});

const banSchema = z.object({
  stage: z.enum(['manual', 'auto']),
  reason: z.string().min(1),
  source: z.string().optional(),
});

const markStrictSchema = z.object({
  kind: z.enum(['restrict_scan', 'restrict_chat_new', 'active']),
});

const reportDisconnectSchema = z.object({
  note: z.string().max(500).optional(),
});

const resolveDisconnectSchema = z.object({
  outcome: z.enum(['restrict_scan', 'restrict_chat_new', 'logged_out', 'banned']),
  reason: z.string().min(1),
});

const STRICT_KIND_LABEL = {
  restrict_scan: 'Restricted Scan',
  restrict_chat_new: 'Restricted Chat New Contact',
  active: 'Active',
};

const SITE_AUDIT_LOCATION = {
  my: 'Malaysia',
  pp: 'Poipet',
};

async function recordAssignmentHistory(accountId, field, oldId, newId, userId) {
  const tableMap = {
    device_id: 'account_device_history',
    sim_id: 'account_sim_history',
    ip_id: 'account_ip_history',
  };
  const colMap = {
    device_id: 'device_id',
    sim_id: 'sim_id',
    ip_id: 'ip_id',
  };
  const table = tableMap[field];
  const col = colMap[field];
  if (!table) return;

  if (oldId) {
    await supabaseAdmin.from(table)
      .update({ unassigned_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq(col, oldId)
      .is('unassigned_at', null);
  }
  if (newId) {
    await supabaseAdmin.from(table).insert({
      account_id: accountId,
      [col]: newId,
      assigned_by: userId,
    });
  }
}

function formatIpAuditLabel(ip) {
  if (!ip?.ip_address) return '—';
  const port = ip.port != null && ip.port !== '' ? String(ip.port) : '8080';
  return `${ip.ip_address}:${port}`;
}

/** Resolve human-readable labels for assignment audit (IP / device / SIM). */
async function resolveAssignmentAuditChanges(diffs, updatedAccount) {
  const ipIds = [...new Set(diffs.flatMap((d) => (
    d.field === 'ip_id' ? [d.fromId, d.toId] : []
  )).filter(Boolean))];
  const deviceIds = [...new Set(diffs.flatMap((d) => (
    d.field === 'device_id' ? [d.fromId, d.toId] : []
  )).filter(Boolean))];
  const simIds = [...new Set(diffs.flatMap((d) => (
    d.field === 'sim_id' ? [d.fromId, d.toId] : []
  )).filter(Boolean))];

  const [ipsRes, devicesRes, simsRes] = await Promise.all([
    ipIds.length
      ? supabaseAdmin.from('ips').select('id, ip_address, port').in('id', ipIds)
      : Promise.resolve({ data: [] }),
    deviceIds.length
      ? supabaseAdmin.from('devices').select('id, device_name').in('id', deviceIds)
      : Promise.resolve({ data: [] }),
    simIds.length
      ? supabaseAdmin.from('sims').select('id, phone_number').in('id', simIds)
      : Promise.resolve({ data: [] }),
  ]);

  const ipsById = Object.fromEntries((ipsRes.data || []).map((r) => [r.id, r]));
  const devicesById = Object.fromEntries((devicesRes.data || []).map((r) => [r.id, r]));
  const simsById = Object.fromEntries((simsRes.data || []).map((r) => [r.id, r]));

  // Prefer joined IP on the updated account when present.
  if (updatedAccount?.ip_id && updatedAccount?.ips) {
    ipsById[updatedAccount.ip_id] = {
      id: updatedAccount.ip_id,
      ip_address: updatedAccount.ips.ip_address,
      port: updatedAccount.ips.port,
    };
  }

  const fieldLabel = { ip_id: 'IP', device_id: 'Device', sim_id: 'SIM' };

  return diffs.map((d) => {
    let from = '—';
    let to = '—';
    if (d.field === 'ip_id') {
      from = d.fromId ? formatIpAuditLabel(ipsById[d.fromId]) : '—';
      to = d.toId ? formatIpAuditLabel(ipsById[d.toId]) : '—';
    } else if (d.field === 'device_id') {
      from = d.fromId ? (devicesById[d.fromId]?.device_name || d.fromId.slice(0, 8)) : '—';
      to = d.toId ? (devicesById[d.toId]?.device_name || d.toId.slice(0, 8)) : '—';
    } else if (d.field === 'sim_id') {
      from = d.fromId ? (simsById[d.fromId]?.phone_number || d.fromId.slice(0, 8)) : '—';
      to = d.toId ? (simsById[d.toId]?.phone_number || d.toId.slice(0, 8)) : '—';
    }
    return {
      field: fieldLabel[d.field] || d.field,
      from,
      to,
      from_id: d.fromId,
      to_id: d.toId,
    };
  });
}

// GET /accounts
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const brandScope = profileBrandScope(req.profile);
    if (brandScope) {
      let q = supabaseAdmin.from('accounts').select(ACCOUNT_SELECT);
      if (req.query.status) q = q.eq('status', req.query.status);
      if (req.query.search) {
        q = q.or(`account_name.ilike.%${req.query.search}%,phone_number.ilike.%${req.query.search}%`);
      }
      const { data, error } = await q
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const enriched = await enrichAccountsIpEmbed(data);
      const brandFiltered = enriched.filter((row) => accountInBrandScope(row, brandScope));
      // Standby pool browsing (for submitting a delivery ticket) must see AVAILABLE accounts
      // before delivery — only the general "check my account status" list needs the ticket gate.
      const scoped = req.query.status === 'AVAILABLE'
        ? brandFiltered
        : await filterDeliveredForBusiness(brandFiltered, req.profile);
      const pageRows = sanitizeAccountsForRole(scoped.slice(offset, offset + limit), req.profile);
      res.set('Cache-Control', 'no-store');
      return res.json(paginatedResponse(pageRows, scoped.length, page, limit));
    }

    let q = supabaseAdmin
      .from('accounts')
      .select(ACCOUNT_SELECT, { count: 'exact' });

    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.search) {
      q = q.or(`account_name.ilike.%${req.query.search}%,phone_number.ilike.%${req.query.search}%`);
    }

    const { data, error, count } = await q
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    const enriched = await enrichAccountsIpEmbed(data);
    res.set('Cache-Control', 'no-store');
    res.json(paginatedResponse(sanitizeAccountsForRole(enriched, req.profile), count || 0, page, limit));
  } catch (e) {
    next(e);
  }
});

// GET /accounts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select(ACCOUNT_SELECT_FULL)
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    // Business is brand-scoped — block lookup of accounts outside their assigned brands.
    const brandScope = profileBrandScope(req.profile);
    if (brandScope) {
      // Business can only check accounts that already went through a delivery ticket —
      // never the internal Registering/Nurturing/Standby pool.
      if (!accountInBrandScope(data, brandScope) || !BUSINESS_VISIBLE_STATUSES.has(data.status)) {
        return res.status(404).json({ error: 'Account not found' });
      }
      const delivered = await deliveredAccountIds([data.id]);
      if (!delivered.has(data.id)) {
        return res.status(404).json({ error: 'Account not found' });
      }
    }

    const { data: history } = await supabaseAdmin
      .from('account_status_history')
      .select('*, profiles(full_name)')
      .eq('account_id', req.params.id)
      .order('changed_at', { ascending: false });

    const [safeData] = sanitizeAccountsForRole([data], req.profile);
    res.json({ ...safeData, statusHistory: history || [] });
  } catch (e) {
    next(e);
  }
});

// POST /accounts
router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    await assertDeviceSlotAvailable(supabaseAdmin, {
      device_id: body.device_id,
      notes: body.notes,
      channel: parseOperatorMeta({ notes: body.notes }).channel,
    });
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .insert({ ...body, created_by: req.profile.id })
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    await supabaseAdmin.from('account_status_history').insert({
      account_id: data.id,
      from_status: null,
      to_status: data.status,
      reason: 'Account created',
      changed_by: req.profile.id,
    });

    await recordInitialAssignments(data.id, {
      device_id: data.device_id,
      sim_id: data.sim_id,
      ip_id: data.ip_id,
    }, req.profile.id);

    await syncResourceBindings(data.id, {
      device_id: data.device_id,
      sim_id: data.sim_id,
      ip_id: data.ip_id,
    }, {});

    if (data.sim_id) {
      const siteKey = parseOperatorMeta(data).site_key;
      await promoteSimToLedger(data.sim_id, { site_key: siteKey });
    }

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'CREATE',
      newValue: data,
      userId: req.profile.id,
      req,
    });

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

// PATCH /accounts/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    if (body.status && body.status !== current.status) {
      assertTransition(current.status, body.status);
    }

    const nextDeviceId = body.device_id !== undefined ? body.device_id : current.device_id;
    const nextNotes = body.notes !== undefined ? body.notes : current.notes;
    if (nextDeviceId) {
      await assertDeviceSlotAvailable(supabaseAdmin, {
        device_id: nextDeviceId,
        notes: nextNotes,
        channel: parseOperatorMeta({ notes: nextNotes }).channel,
        account_id: req.params.id,
      });
    }

    const updates = pick(body, [
      'account_name', 'phone_number', 'device_id', 'sim_id', 'ip_id',
      'wsaf_slot', 'notes', 'last_active',
    ]);

    if (body.status) updates.status = body.status;

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update(updates)
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    const assignmentDiffs = [];
    for (const field of ['device_id', 'sim_id', 'ip_id']) {
      if (body[field] !== undefined && body[field] !== current[field]) {
        assignmentDiffs.push({ field, fromId: current[field], toId: body[field] });
        await recordAssignmentHistory(data.id, field, current[field], body[field], req.profile.id);
      }
    }

    if (body.device_id !== undefined || body.sim_id !== undefined || body.ip_id !== undefined) {
      await syncResourceBindings(data.id, {
        device_id: data.device_id,
        sim_id: data.sim_id,
        ip_id: data.ip_id,
      }, current);
    }

    if (body.sim_id && body.sim_id !== current.sim_id) {
      await promoteSimToLedger(body.sim_id, { site_key: parseOperatorMeta(data).site_key });
    }

    if (assignmentDiffs.length) {
      const changes = await resolveAssignmentAuditChanges(assignmentDiffs, data);
      const primary = changes[0] || {};
      await writeAudit({
        entityType: 'account',
        entityId: data.id,
        action: 'ASSIGNMENT_CHANGE',
        previousValue: Object.fromEntries(
          assignmentDiffs.map((d) => [d.field, d.fromId]),
        ),
        newValue: {
          account_name: data.account_name,
          phone_number: data.phone_number,
          field: primary.field,
          from: primary.from,
          to: primary.to,
          changes,
        },
        metadata: {
          account_name: data.account_name,
          field: primary.field,
          from: primary.from,
          to: primary.to,
          changes,
        },
        userId: req.profile.id,
        req,
      });
    }

    if (body.status && body.status !== current.status) {
      await supabaseAdmin.from('account_status_history').insert({
        account_id: data.id,
        from_status: current.status,
        to_status: body.status,
        reason: body.reason || 'Status updated',
        changed_by: req.profile.id,
      });
      await writeAudit({
        entityType: 'account',
        entityId: data.id,
        action: 'STATE_CHANGE',
        previousValue: { status: current.status },
        newValue: { status: body.status, reason: body.reason },
        userId: req.profile.id,
        req,
      });
    } else if (!assignmentDiffs.length) {
      await writeAudit({
        entityType: 'account',
        entityId: data.id,
        action: 'UPDATE',
        previousValue: current,
        newValue: data,
        userId: req.profile.id,
        req,
      });
    }

    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /accounts/:id/transition
router.post('/:id/transition', async (req, res, next) => {
  try {
    const { to_status, reason } = transitionSchema.parse(req.body);
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    assertTransition(current.status, to_status);

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ status: to_status })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    await supabaseAdmin.from('account_status_history').insert({
      account_id: data.id,
      from_status: current.status,
      to_status,
      reason: reason || 'State transition',
      changed_by: req.profile.id,
    });

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'STATE_CHANGE',
      previousValue: { status: current.status },
      newValue: { status: to_status, reason },
      userId: req.profile.id,
      req,
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /accounts/:id/ban — two-stage ban logging (manual day 1–3, auto day 4+)
router.post('/:id/ban', async (req, res, next) => {
  try {
    const { stage, reason, source } = banSchema.parse(req.body);
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    assertTransition(current.status, 'BANNED');

    const banReason = `[${stage}] ${reason}${source ? ` · ${source}` : ''}`;

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ status: 'BANNED' })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    await supabaseAdmin.from('account_status_history').insert({
      account_id: data.id,
      from_status: current.status,
      to_status: 'BANNED',
      reason: banReason,
      changed_by: req.profile.id,
    });

    await bumpIpRisk(current.ip_id);

    const recNotes = serializeRecoveryNotes(data.notes, recoveryOnBanDefaults(stage, reason));
    await supabaseAdmin.from('accounts').update({ notes: recNotes }).eq('id', data.id);
    data.notes = recNotes;

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'STATE_CHANGE',
      previousValue: { status: current.status },
      newValue: { status: 'BANNED', reason: banReason, ban_stage: stage },
      metadata: { ban_log: true, stage, reason, source },
      userId: req.profile.id,
      req,
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /accounts/:id/mark-strict — set Current Status (Active | Restricted Scan | Chat New)
router.post('/:id/mark-strict', async (req, res, next) => {
  try {
    const { kind } = markStrictSchema.parse(req.body);
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    const label = STRICT_KIND_LABEL[kind];
    const meta = parseOperatorMeta(current);
    const siteKey = meta.site_key || 'my';
    const prevLabel = STRICT_KIND_LABEL[meta.restrict_kind] || (meta.restrict_kind ? meta.restrict_kind : 'Active');

    let humanNote;
    let metaPatch;
    let feedingStatus = 'Restrict';
    let auditReason;
    let strictScanPossible = false;

    if (kind === 'active') {
      humanNote = 'Active — restriction cleared';
      metaPatch = { restrict_kind: null };
      feedingStatus = 'Active';
      auditReason = 'operator_status_active';
    } else if (kind === 'restrict_chat_new') {
      humanNote = 'Restricted Chat New Contact — can scan; chat limited to existing contacts only';
      metaPatch = { restrict_kind: kind };
      auditReason = 'operator_strict_chat_new';
    } else {
      humanNote = 'Restricted Scan — cannot scan / re-link during restriction period';
      metaPatch = {
        restrict_kind: kind,
        nurturing_phase: 'manual',
        nurturing_started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      };
      auditReason = 'operator_strict_scan';
      strictScanPossible = true;
    }

    const notes = mergeOperatorNotes(current.notes, metaPatch, humanNote);
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ notes })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'UPDATE',
      previousValue: {
        status: current.status,
        restrict_kind: meta.restrict_kind || null,
        human_note: meta.human_note || null,
      },
      newValue: {
        account_name: data.account_name,
        phone_number: data.phone_number,
        field: 'Current Status',
        from: prevLabel,
        to: label,
        restrictKind: kind === 'active' ? null : kind,
        human_note: humanNote,
      },
      metadata: {
        account_name: data.account_name,
        field: 'Current Status',
        from: prevLabel,
        to: label,
        restrictKind: kind === 'active' ? null : kind,
        reason: auditReason,
      },
      userId: req.profile.id,
      req,
    });

    let feedingAudit = null;
    try {
      const ipJoin = data.ips;
      const ipAddress = Array.isArray(ipJoin)
        ? ipJoin[0]?.ip_address
        : ipJoin?.ip_address;
      feedingAudit = await postWsafAuditRecord({
        slot: data.wsaf_slot,
        accountName: data.account_name,
        feedingStatus,
        reason: auditReason,
        restrictKind: kind === 'active' ? null : kind,
        runId: `ams-status-${auditReason}-${data.id}-${Date.now()}`,
        location: SITE_AUDIT_LOCATION[siteKey] || null,
        ipAddress: ipAddress || null,
        strictScanPossible,
      });
    } catch (feedErr) {
      console.warn('[mark-strict] feeding audit skipped:', feedErr?.message || feedErr);
    }

    res.json({
      ...data,
      _strict: {
        kind,
        label,
        amsAudit: true,
        feedingAudit: Boolean(feedingAudit),
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /accounts/:id/report-disconnect — business self-reports "I got logged out"
// (business logs into their own WhatsApp Web; AMS/FeedFlow has no visibility into that
// session, so this is the only way R&M finds out without a WhatsApp group message).
router.post('/:id/report-disconnect', async (req, res, next) => {
  try {
    const { note } = reportDisconnectSchema.parse(req.body);
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    if (req.profile?.role === 'business') {
      const brandScope = profileBrandScope(req.profile);
      if (!accountInBrandScope(current, brandScope)) {
        return res.status(404).json({ error: 'Account not found' });
      }
    }
    if (current.status !== 'IN_USE') {
      return res.status(400).json({ error: 'Only accounts currently In Use can be reported as disconnected' });
    }

    const meta = parseOperatorMeta(current);
    if (meta.disconnect_report) {
      const [already] = sanitizeAccountsForRole([current], req.profile);
      return res.json({ ...already, _alreadyReported: true });
    }

    const reporterName = req.profile?.full_name || req.profile?.username || 'Business';
    const report = {
      reported_at: new Date().toISOString(),
      reported_by: reporterName,
      note: (note || '').trim(),
    };
    const notes = mergeOperatorNotes(current.notes, { disconnect_report: report });

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ notes })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'UPDATE',
      previousValue: { disconnect_report: null },
      newValue: {
        account_name: data.account_name,
        field: 'Disconnect report',
        reported_by: reporterName,
        note: report.note,
      },
      metadata: {
        account_name: data.account_name,
        field: 'Disconnect report',
        business_report: true,
        reported_by: reporterName,
      },
      userId: req.profile.id,
      req,
    });

    const [safeData] = sanitizeAccountsForRole([data], req.profile);
    res.status(201).json(safeData);
  } catch (e) {
    next(e);
  }
});

// POST /accounts/:id/resolve-disconnect — R&M/operator actions a business disconnect
// report: pick the real outcome (Restricted / Logged out / Banned) with a reason, which
// updates account status + history so the business immediately sees it themselves.
router.post('/:id/resolve-disconnect', async (req, res, next) => {
  try {
    const { outcome, reason } = resolveDisconnectSchema.parse(req.body);
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    const meta = parseOperatorMeta(current);
    if (!meta.disconnect_report) {
      return res.status(400).json({ error: 'No pending disconnect report for this account' });
    }
    const reportedBy = meta.disconnect_report.reported_by || 'Business';

    let data;
    let toLabel;

    if (outcome === 'logged_out' || outcome === 'banned') {
      const toStatus = outcome === 'logged_out' ? 'LOGGED_OUT' : 'BANNED';
      assertTransition(current.status, toStatus);
      const notes = mergeOperatorNotes(current.notes, { disconnect_report: null });

      const { data: updated, error } = await supabaseAdmin
        .from('accounts')
        .update({ status: toStatus, notes })
        .eq('id', req.params.id)
        .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
        .single();
      if (error) throw error;

      await supabaseAdmin.from('account_status_history').insert({
        account_id: updated.id,
        from_status: current.status,
        to_status: toStatus,
        reason: `${reason} · reported by ${reportedBy}`,
        changed_by: req.profile.id,
      });

      if (toStatus === 'BANNED') {
        await bumpIpRisk(current.ip_id);
        const recNotes = serializeRecoveryNotes(updated.notes, recoveryOnBanDefaults('manual', reason));
        await supabaseAdmin.from('accounts').update({ notes: recNotes }).eq('id', updated.id);
        updated.notes = recNotes;
      }

      data = updated;
      toLabel = toStatus === 'BANNED' ? 'Banned' : 'Logged out';
    } else {
      // restrict_scan | restrict_chat_new — WA-level overlay, account.status stays IN_USE.
      const label = STRICT_KIND_LABEL[outcome];
      const metaPatch = outcome === 'restrict_scan'
        ? {
            restrict_kind: outcome,
            nurturing_phase: 'manual',
            nurturing_started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            disconnect_report: null,
          }
        : { restrict_kind: outcome, disconnect_report: null };
      const humanNote = outcome === 'restrict_scan'
        ? 'Restricted Scan — cannot scan / re-link during restriction period'
        : 'Restricted Chat New Contact — can scan; chat limited to existing contacts only';
      const notes = mergeOperatorNotes(current.notes, metaPatch, humanNote);

      const { data: updated, error } = await supabaseAdmin
        .from('accounts')
        .update({ notes })
        .eq('id', req.params.id)
        .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
        .single();
      if (error) throw error;
      data = updated;
      toLabel = label;
    }

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'STATE_CHANGE',
      previousValue: { status: current.status, disconnect_report: meta.disconnect_report },
      newValue: { status: data.status, outcome, reason, resolved_report: true },
      metadata: {
        account_name: data.account_name,
        field: 'Disconnect report',
        outcome,
        reason,
        to: toLabel,
        reported_by: reportedBy,
      },
      userId: req.profile.id,
      req,
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
});

// DELETE /accounts/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: current } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();

    const { error } = await supabaseAdmin.from('accounts').delete().eq('id', req.params.id);
    if (error) throw error;

    await writeAudit({
      entityType: 'account',
      entityId: req.params.id,
      action: 'DELETE',
      previousValue: current,
      userId: req.profile.id,
      req,
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
