import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { circuitBreaker } from '../../lib/circuitBreaker.js';
import { assertTransition, ACCOUNT_STATUSES } from '../../lib/stateMachine.js';
import { parsePagination, paginatedResponse, pick } from '../../lib/pagination.js';
import {
  syncResourceBindings, recordInitialAssignments, bumpIpRisk, promoteSimToLedger,
} from '../../lib/resourceBindings.js';
import {
  serializeRecoveryNotes,
  recoveryOnBanDefaults,
  recoveryOnSimAnomalyDefaults,
} from '../../lib/accountRecovery.js';
import {
  findSimForAccount,
  recordSimAnomaly,
  simAnomalyReasonLabel,
  SIM_ANOMALY_REASON_IDS,
} from '../../lib/simAnomaly.js';
import {
  ACCOUNT_SELECT,
  ACCOUNT_SELECT_FULL,
  ACCOUNT_SELECT_WITH_SIM_LOCATION,
} from '../../lib/accountSelect.js';
import { enrichAccountsIpEmbed } from '../../lib/accountEnrich.js';
import { parseOperatorMeta, mergeOperatorNotes } from '../../lib/accountMeta.js';
import {
  openAnomalyEvent,
  closeAnomalyEvent,
  eventLogoutAt,
  finalizeAnomaly,
  ANOMALY_FALSE_POSITIVE,
} from '../../lib/anomalyEvent.js';
import { assertDeviceSlotAvailable, DeviceSlotError } from '../../lib/deviceSlots.js';
import { dropWsafSessionForAccount, postWsafAuditRecord } from '../../lib/wsafBridge.js';
import { accountInBrandScope, profileBrandScope } from '../../lib/accountBrand.js';
import { accountInStaffScope, profileStaffScope } from '../../lib/accountStaff.js';
import { parseTicketMeta } from '../../lib/ticketMeta.js';
import { isBrandSharedAccount } from '../../lib/accountType.js';
import {
  appendAccountUsageEvent,
  listAccountUsageEvents,
  usageActorFromReq,
} from '../../lib/accountUsage.js';

const MS_DAY = 86_400_000;

function elapsedNurtureDays(startAt, endAt = new Date()) {
  if (!startAt) return 1;
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.max(1, Math.floor((end - start) / MS_DAY) + 1);
}

function dayCountLabel(n) {
  const d = Math.max(1, Number(n) || 1);
  return d === 1 ? '1 day' : `${d} days`;
}

function nurtureCompleteReason(account, fallback) {
  const meta = parseOperatorMeta(account);
  const start = meta.nurturing_started_at || account.created_at;
  const total = elapsedNurtureDays(start);
  const manualDays = Math.min(3, total);
  const autoDays = meta.nurturing_phase === 'auto' ? Math.max(0, total - manualDays) : 0;
  const parts = [`Manual nurturing ${dayCountLabel(manualDays)}`];
  if (autoDays > 0) parts.push(`System nurturing ${dayCountLabel(autoDays)}`);
  const detail = `${parts.join(', ')} → Standby`;
  if (!fallback) return `Nurturing complete — ${detail}`;
  if (/manual nurturing|system nurturing/i.test(fallback)) return fallback;
  return `${fallback} · ${detail}`;
}

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
  // Engine auto-detect logout — operator/admin only (background sync from AMS UI).
  if (req.method === 'POST' && /\/engine-disconnect$/.test(req.path)) {
    return requireRole('admin', 'operator')(req, res, next);
  }
  if (req.method === 'POST' && /\/ack-notice$/.test(req.path)) {
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

/** Load an account with device embed so brand ACL can resolve SGD-M24-… → M24SG. */
async function loadAccountById(id, select = ACCOUNT_SELECT) {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select(select)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function businessCannotAccess(account, profile) {
  if (profile?.role !== 'business') return false;
  const brandScope = profileBrandScope(profile);
  if (!accountInBrandScope(account, brandScope)) return true;
  if (!accountInStaffScope(account, profileStaffScope(profile))) return true;
  return false;
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

const engineDisconnectSchema = z.object({
  note: z.string().max(500).optional(),
  slot: z.number().int().optional().nullable(),
  loggedOut: z.boolean().optional(),
});

const resolveDisconnectSchema = z.object({
  outcome: z.enum([
    'restrict_scan',
    'restrict_chat_new',
    'logged_out',
    'banned',
    'false_positive',
  ]),
  reason: z.string().min(1),
});

const simAnomalySchema = z.object({
  reason: z.enum(SIM_ANOMALY_REASON_IDS),
  note: z.string().max(500).optional().nullable(),
  source: z.string().max(60).optional(),
});

const SIM_ANOMALY_FROM_STATUSES = new Set(['NURTURING', 'AVAILABLE', 'IN_USE', 'LOGGED_OUT']);

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
    const { page, limit, offset } = parsePagination(req.query, { maxLimit: 500 });
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
      const staffScope = profileStaffScope(req.profile);
      const staffFiltered = brandFiltered.filter((row) => accountInStaffScope(row, staffScope));
      // Standby pool browsing (for submitting a delivery ticket) must see AVAILABLE accounts
      // before delivery — only the general "check my account status" list needs the ticket gate.
      const delivered = req.query.status === 'AVAILABLE'
        ? staffFiltered
        : await filterDeliveredForBusiness(staffFiltered, req.profile);
      const withNotice = req.query.status === 'AVAILABLE'
        ? []
        : staffFiltered.filter((row) => parseOperatorMeta(row).business_notice?.type === 'returned_standby');
      const byId = new Map();
      [...delivered, ...withNotice].forEach((row) => byId.set(row.id, row));
      const scoped = [...byId.values()];
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
    const data = await loadAccountById(req.params.id, ACCOUNT_SELECT_FULL);
    if (!data) return res.status(404).json({ error: 'Account not found' });

    // Business is brand-scoped — block lookup of accounts outside their assigned brands.
    // Notices (review result / returned to Standby) stay readable even if status left IN_USE.
    const brandScope = profileBrandScope(req.profile);
    if (brandScope) {
      if (businessCannotAccess(data, req.profile)) {
        return res.status(404).json({ error: 'Account not found' });
      }
      const notice = parseOperatorMeta(data).business_notice;
      const readyNotice = notice?.type === 'returned_standby';
      const visibleStatus = BUSINESS_VISIBLE_STATUSES.has(data.status);
      if (!visibleStatus && !readyNotice) {
        return res.status(404).json({ error: 'Account not found' });
      }
      if (visibleStatus) {
        const delivered = await deliveredAccountIds([data.id]);
        if (!delivered.has(data.id) && !readyNotice) {
          return res.status(404).json({ error: 'Account not found' });
        }
      }
    }

    const { data: history } = await supabaseAdmin
      .from('account_status_history')
      .select('*, profiles(full_name)')
      .eq('account_id', req.params.id)
      .order('changed_at', { ascending: false });

    const [safeData] = sanitizeAccountsForRole([data], req.profile);

    const { data: ticketRows } = await supabaseAdmin
      .from('tickets')
      .select('id, ticket_number, status, created_at, closed_at, description')
      .eq('account_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(8);

    const deliveryTickets = (ticketRows || []).map((t) => {
      const meta = parseTicketMeta(t);
      return {
        id: t.id,
        ticket_number: t.ticket_number,
        status: t.status,
        created_at: t.created_at,
        closed_at: t.closed_at,
        submitted_at: meta.submitted_at || t.created_at,
        in_progress_at: meta.in_progress_at || null,
        delivery_stage: meta.delivery_stage || null,
      };
    });

    res.json({ ...safeData, statusHistory: history || [], deliveryTickets });
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
    // Registration IP is the ledger record — never unbind by sending ip_id: null
    // (scan-in with empty engine proxy used to wipe it).
    if (updates.ip_id == null) delete updates.ip_id;

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
      const nextId = field === 'ip_id' ? updates.ip_id : body[field];
      if (nextId !== undefined && nextId !== current[field]) {
        assignmentDiffs.push({ field, fromId: current[field], toId: nextId });
        await recordAssignmentHistory(data.id, field, current[field], nextId, req.profile.id);
      }
    }

    if (body.device_id !== undefined || body.sim_id !== undefined || updates.ip_id !== undefined) {
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

    const prevMeta = parseOperatorMeta(current);
    const nextMeta = parseOperatorMeta(data);
    const phaseChanged = prevMeta.nurturing_phase
      && nextMeta.nurturing_phase
      && prevMeta.nurturing_phase !== nextMeta.nurturing_phase;

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
    } else if (phaseChanged && (current.status === 'NURTURING' || data.status === 'NURTURING')) {
      const start = prevMeta.nurturing_started_at || current.created_at;
      const days = elapsedNurtureDays(start);
      let phaseReason;
      if (prevMeta.nurturing_phase === 'manual' && nextMeta.nurturing_phase === 'auto') {
        phaseReason = `Scan-in — Manual nurturing ${dayCountLabel(Math.min(3, days))} → System nurturing`;
      } else if (prevMeta.nurturing_phase === 'auto' && nextMeta.nurturing_phase === 'manual') {
        phaseReason = 'Returned to Manual nurturing (from System nurturing)';
      } else {
        phaseReason = `Nurturing phase ${prevMeta.nurturing_phase} → ${nextMeta.nurturing_phase}`;
      }
      await supabaseAdmin.from('account_status_history').insert({
        account_id: data.id,
        from_status: 'NURTURING',
        to_status: 'NURTURING',
        reason: phaseReason,
        changed_by: req.profile.id,
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

    let historyReason = reason || 'State transition';
    if (current.status === 'REGISTERING' && to_status === 'NURTURING') {
      historyReason = reason && !/^activated/i.test(reason)
        ? reason
        : 'Started Manual nurturing';
    } else if (current.status === 'NURTURING' && to_status === 'AVAILABLE') {
      historyReason = nurtureCompleteReason(current, reason);
    }

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
      reason: historyReason,
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
router.post('/:id/ban', circuitBreaker('account_ban'), async (req, res, next) => {
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
    const meta = parseOperatorMeta(current);
    const closed = finalizeAnomaly(meta, {
      outcome: 'banned',
      reason: banReason,
      fromStatus: current.status,
      source: source || 'ban_form',
      reportedBy: req.profile?.full_name || req.profile?.username || 'R&M',
    });
    const logoutAt = eventLogoutAt(closed.last_anomaly) || new Date().toISOString();
    const notesWithEvent = mergeOperatorNotes(current.notes, { ...closed, business_notice: null });

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ status: 'BANNED', notes: notesWithEvent })
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
      changed_at: logoutAt,
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

    if (kind !== 'active') {
      Object.assign(metaPatch, finalizeAnomaly(meta, {
        outcome: kind,
        reason: humanNote,
        fromStatus: current.status,
        source: 'mark_strict',
        restrictKind: kind,
        reportedBy: req.profile?.full_name || req.profile?.username || 'R&M',
      }));
    }

    const notes = mergeOperatorNotes(current.notes, metaPatch, humanNote);
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ notes })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    if (kind === 'restrict_scan' && current.status === 'NURTURING' && meta.nurturing_phase === 'auto') {
      await supabaseAdmin.from('account_status_history').insert({
        account_id: data.id,
        from_status: 'NURTURING',
        to_status: 'NURTURING',
        reason: 'Returned to Manual nurturing (Restricted Scan)',
        changed_by: req.profile.id,
      });
    }

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

// POST /accounts/:id/engine-disconnect — FeedFlow slot lost live connection for an
// IN_USE account. Mark LOGGED_OUT + open disconnect_report so R&M gets the header bell
// (even when Business did not self-report).
router.post('/:id/engine-disconnect', circuitBreaker('account_disconnect'), async (req, res, next) => {
  try {
    const { note, slot, loggedOut } = engineDisconnectSchema.parse(req.body || {});
    if (loggedOut !== true) {
      return res.json({ _skipped: true, reason: 'preview_down_not_logout' });
    }
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    if (current.status !== 'IN_USE' && current.status !== 'NURTURING') {
      const [already] = sanitizeAccountsForRole([current], req.profile);
      return res.json({ ...already, _skipped: true, reason: 'not_keep_alive' });
    }

    const meta = parseOperatorMeta(current);
    const reportNote = (note || '').trim()
      || 'Auto-detected by AMS: FeedFlow slot offline / logged out';
    const alreadyPending = Boolean(
      meta.disconnect_report?.logout_at || meta.disconnect_report?.reported_at,
    );
    const opened = openAnomalyEvent(meta, {
      fromStatus: current.status,
      reportedBy: 'AMS Engine',
      note: reportNote,
      source: 'engine_health',
      slot: slot == null ? null : Number(slot),
    });
    const notes = mergeOperatorNotes(current.notes, opened);

    const nextStatus = current.status === 'IN_USE' ? 'LOGGED_OUT' : current.status;
    if (nextStatus !== current.status) {
      assertTransition(current.status, nextStatus);
    }

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ status: nextStatus, notes })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    if (!alreadyPending && nextStatus !== current.status) {
      await supabaseAdmin.from('account_status_history').insert({
        account_id: data.id,
        from_status: current.status,
        to_status: nextStatus,
        reason: `[pending] ${reportNote}`,
        changed_by: req.profile.id,
        changed_at: eventLogoutAt(opened.disconnect_report),
      });
    }

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'STATE_CHANGE',
      previousValue: { status: current.status, disconnect_report: meta.disconnect_report || null },
      newValue: {
        status: nextStatus,
        disconnect_report: opened.disconnect_report,
        reason: reportNote,
      },
      metadata: {
        account_name: data.account_name,
        field: 'Engine disconnect',
        engine_health: true,
        slot: opened.disconnect_report.slot,
        confirmation_status: 'pending',
        logout_at: eventLogoutAt(opened.disconnect_report),
      },
      userId: req.profile.id,
      req,
    });

    if (nextStatus === 'LOGGED_OUT' && loggedOut === true) {
      dropWsafSessionForAccount({ ...current, wsaf_slot: slot ?? current.wsaf_slot }).catch(() => {});
    }

    res.status(201).json(data);
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
    const current = await loadAccountById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Account not found' });

    if (businessCannotAccess(current, req.profile)) {
      return res.status(404).json({ error: 'Account not found' });
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
    const opened = openAnomalyEvent(meta, {
      fromStatus: current.status,
      reportedBy: reporterName,
      note: (note || '').trim(),
      source: 'business',
    });
    const notes = mergeOperatorNotes(current.notes, opened);

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ notes })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    if (isBrandSharedAccount(current)) {
      const actor = usageActorFromReq(req);
      await appendAccountUsageEvent({
        accountId: current.id,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'disconnect_report',
        metadata: { note: opened.disconnect_report?.note || '' },
      });
    }

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'UPDATE',
      previousValue: { disconnect_report: null },
      newValue: {
        account_name: data.account_name,
        field: 'Disconnect report',
        reported_by: reporterName,
        note: opened.disconnect_report.note,
      },
      metadata: {
        account_name: data.account_name,
        field: 'Disconnect report',
        business_report: true,
        reported_by: reporterName,
        confirmation_status: 'pending',
        logout_at: eventLogoutAt(opened.disconnect_report),
      },
      userId: req.profile.id,
      req,
    });

    dropWsafSessionForAccount(current).catch(() => {});

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
    const logoutAt = eventLogoutAt(meta.disconnect_report);
    const closed = closeAnomalyEvent(meta, {
      outcome,
      reason,
      restrictKind: (outcome === 'restrict_scan' || outcome === 'restrict_chat_new') ? outcome : null,
    });

    let data;
    let toLabel;
    let nextStatus = current.status;

    if (outcome === ANOMALY_FALSE_POSITIVE) {
      const fromStatus = meta.disconnect_report.from_status || current.status;
      nextStatus = fromStatus === 'NURTURING' || fromStatus === 'IN_USE' ? fromStatus : current.status;
      if (nextStatus !== current.status) assertTransition(current.status, nextStatus);
      const notes = mergeOperatorNotes(current.notes, {
        ...closed,
        business_notice: null,
      });
      const { data: updated, error } = await supabaseAdmin
        .from('accounts')
        .update({ status: nextStatus, notes })
        .eq('id', req.params.id)
        .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
        .single();
      if (error) throw error;
      data = updated;
      toLabel = 'False positive';
      await supabaseAdmin.from('account_status_history').insert({
        account_id: data.id,
        from_status: current.status,
        to_status: nextStatus,
        reason: `[false_positive] ${reason} · reported by ${reportedBy}`,
        changed_by: req.profile.id,
        changed_at: logoutAt,
      });
    } else if (outcome === 'logged_out' || outcome === 'banned') {
      nextStatus = outcome === 'logged_out' ? 'LOGGED_OUT' : 'BANNED';
      if (current.status !== nextStatus) {
        assertTransition(current.status, nextStatus);
      }
      const notes = mergeOperatorNotes(current.notes, { ...closed, business_notice: null });

      const { data: updated, error } = await supabaseAdmin
        .from('accounts')
        .update({ status: nextStatus, notes })
        .eq('id', req.params.id)
        .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
        .single();
      if (error) throw error;

      const histReason = outcome === 'banned'
        ? `[manual] ${reason} · reported by ${reportedBy}`
        : `${reason} · reported by ${reportedBy}`;
      await supabaseAdmin.from('account_status_history').insert({
        account_id: updated.id,
        from_status: current.status,
        to_status: nextStatus,
        reason: histReason,
        changed_by: req.profile.id,
        changed_at: logoutAt,
      });

      if (nextStatus === 'BANNED') {
        await bumpIpRisk(current.ip_id);
        const recNotes = serializeRecoveryNotes(updated.notes, recoveryOnBanDefaults('manual', reason));
        await supabaseAdmin.from('accounts').update({ notes: recNotes }).eq('id', updated.id);
        updated.notes = recNotes;
      }

      data = updated;
      toLabel = nextStatus === 'BANNED' ? 'Banned' : 'Logged out';
      dropWsafSessionForAccount(current).catch(() => {});
    } else {
      const label = STRICT_KIND_LABEL[outcome];
      nextStatus = current.status === 'LOGGED_OUT' ? 'IN_USE' : current.status;
      if (nextStatus !== current.status) assertTransition(current.status, nextStatus);
      const metaPatch = {
        ...closed,
        restrict_kind: outcome,
        business_notice: null,
        ...(outcome === 'restrict_scan'
          ? {
              nurturing_phase: 'manual',
              nurturing_started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            }
          : {}),
      };
      const humanNote = outcome === 'restrict_scan'
        ? 'Restricted Scan — cannot scan / re-link during restriction period'
        : 'Restricted Chat New Contact — can scan; chat limited to existing contacts only';
      const notes = mergeOperatorNotes(current.notes, metaPatch, humanNote);

      const { data: updated, error } = await supabaseAdmin
        .from('accounts')
        .update({ status: nextStatus, notes })
        .eq('id', req.params.id)
        .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
        .single();
      if (error) throw error;
      data = updated;
      toLabel = label;
      await supabaseAdmin.from('account_status_history').insert({
        account_id: data.id,
        from_status: current.status,
        to_status: nextStatus,
        reason: `[restrict] ${label} · ${reason} · reported by ${reportedBy}`,
        changed_by: req.profile.id,
        changed_at: logoutAt,
      });
    }

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'STATE_CHANGE',
      previousValue: { status: current.status, disconnect_report: meta.disconnect_report },
      newValue: {
        status: data.status,
        outcome,
        reason,
        resolved_report: true,
        logout_at: logoutAt,
      },
      metadata: {
        account_name: data.account_name,
        field: 'Disconnect report',
        outcome,
        reason,
        to: toLabel,
        reported_by: reportedBy,
        logout_at: logoutAt,
      },
      userId: req.profile.id,
      req,
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /accounts/:id/sim-anomaly — account cannot re-verify because of its SIM
// (suspended / expired / no OTP). Not a ban: goes to the Recovery queue and is logged
// per carrier in sim_anomalies. Also closes a pending disconnect report if one is open.
router.post('/:id/sim-anomaly', async (req, res, next) => {
  try {
    const { reason, note, source } = simAnomalySchema.parse(req.body || {});
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    if (!SIM_ANOMALY_FROM_STATUSES.has(current.status)) {
      return res.status(422).json({
        error: `SIM Card Anomaly cannot be logged while the account is ${current.status}`,
      });
    }
    assertTransition(current.status, 'RECOVERING');

    const label = simAnomalyReasonLabel(reason);
    const detail = String(note || '').trim();
    const reasonText = detail ? `${label} · ${detail}` : label;
    const reportedBy = req.profile?.full_name || req.profile?.username || 'R&M';
    const meta = parseOperatorMeta(current);
    const closed = finalizeAnomaly(meta, {
      outcome: 'sim_anomaly',
      reason: reasonText,
      fromStatus: meta.disconnect_report?.from_status || current.status,
      source: source || 'sim_anomaly_form',
      reportedBy,
    });
    const logoutAt = eventLogoutAt(closed.last_anomaly) || new Date().toISOString();
    const opNotes = mergeOperatorNotes(current.notes, {
      ...closed,
      restrict_kind: null,
      business_notice: null,
    });
    const notes = serializeRecoveryNotes(opNotes, recoveryOnSimAnomalyDefaults(reason, label));

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ status: 'RECOVERING', notes })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    await supabaseAdmin.from('account_status_history').insert({
      account_id: data.id,
      from_status: current.status,
      to_status: 'RECOVERING',
      reason: `[sim_anomaly] ${reasonText} · reported by ${reportedBy}`,
      changed_by: req.profile.id,
      changed_at: logoutAt,
    });

    const sim = await findSimForAccount(current);
    const { anomaly } = await recordSimAnomaly({
      sim,
      account: current,
      platform: 'whatsapp',
      reason,
      detail: detail || null,
      source: source || 'account',
      profile: req.profile,
      fallbackCarrier: meta.prepared_telco || null,
      fallbackSiteKey: meta.site_key || null,
    });

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'STATE_CHANGE',
      previousValue: { status: current.status },
      newValue: { status: 'RECOVERING', outcome: 'sim_anomaly', reason },
      metadata: {
        account_name: data.account_name,
        field: 'SIM Card Anomaly',
        outcome: 'sim_anomaly',
        reason,
        reason_label: label,
        note: detail || null,
        carrier: anomaly.carrier,
        sim_anomaly_id: anomaly.id,
        to: 'Recovering',
      },
      userId: req.profile.id,
      req,
    });

    res.json({ ...data, sim_anomaly: anomaly });
  } catch (e) {
    next(e);
  }
});

const returnStandbySchema = z.object({
  reason: z.string().max(500).optional(),
});

// POST /accounts/:id/return-standby — restriction period over; put back in Standby
// so the same business staff can request the account again via a delivery ticket.
router.post('/:id/return-standby', async (req, res, next) => {
  try {
    const { reason } = returnStandbySchema.parse(req.body || {});
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    const meta = parseOperatorMeta(current);
    if (current.status !== 'IN_USE' || !meta.restrict_kind) {
      return res.status(400).json({
        error: 'Only In Use accounts that are Restricted can return to Standby',
      });
    }

    assertTransition(current.status, 'AVAILABLE');
    const label = STRICT_KIND_LABEL[meta.restrict_kind] || 'Restricted';
    const note = (reason || '').trim()
      || `${label} period ended — returned to Standby for re-delivery`;
    const shared = isBrandSharedAccount(current);
    const noticeBody = shared
      ? `Restriction ended. ${current.account_name} is back on Standby — any Brand member can open Delivery tickets to request a new scan.`
      : `Restriction ended. ${current.account_name} is back on Standby — open Delivery tickets to request a new scan.`;
    const notices = mergeOperatorNotes(current.notes, {
      restrict_kind: null,
      disconnect_report: null,
      business_notice: {
        type: 'returned_standby',
        at: new Date().toISOString(),
        title: `${current.account_name || 'Account'} is ready to scan again`,
        body: noticeBody,
      },
    }, note);

    if (shared) {
      const actor = usageActorFromReq(req);
      await appendAccountUsageEvent({
        accountId: current.id,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: 'return_standby',
        metadata: { reason: note },
      });
    }

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ status: 'AVAILABLE', notes: notices, wsaf_slot: null })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    await supabaseAdmin.from('account_status_history').insert({
      account_id: data.id,
      from_status: current.status,
      to_status: 'AVAILABLE',
      reason: note,
      changed_by: req.profile.id,
    });

    await writeAudit({
      entityType: 'account',
      entityId: data.id,
      action: 'STATE_CHANGE',
      previousValue: { status: current.status, restrict_kind: meta.restrict_kind },
      newValue: { status: 'AVAILABLE', reason: note },
      metadata: {
        account_name: data.account_name,
        field: 'Return to Standby',
        from: label,
        to: 'Standby',
      },
      userId: req.profile.id,
      req,
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
});

// GET /accounts/:id/usage — append-only usage ledger (Brand-shared)
router.get('/:id/usage', async (req, res, next) => {
  try {
    const current = await loadAccountById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Account not found' });

    if (businessCannotAccess(current, req.profile)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const events = await listAccountUsageEvents(current.id, { limit });
    res.set('Cache-Control', 'no-store');
    res.json({ data: events });
  } catch (e) {
    next(e);
  }
});

// POST /accounts/:id/ack-notice — business dismisses a status notice
router.post('/:id/ack-notice', async (req, res, next) => {
  try {
    const current = await loadAccountById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Account not found' });

    if (businessCannotAccess(current, req.profile)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const notes = mergeOperatorNotes(current.notes, { business_notice: null });
    const { data, error } = await supabaseAdmin
      .from('accounts')
      .update({ notes })
      .eq('id', req.params.id)
      .select(ACCOUNT_SELECT_WITH_SIM_LOCATION)
      .single();
    if (error) throw error;

    const [safeData] = sanitizeAccountsForRole([data], req.profile);
    res.json(safeData);
  } catch (e) {
    next(e);
  }
});

// DELETE /accounts/:id
router.delete('/:id', circuitBreaker('delete'), async (req, res, next) => {
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
