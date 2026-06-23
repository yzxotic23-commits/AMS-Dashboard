import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { assertTransition, ACCOUNT_STATUSES } from '../../lib/stateMachine.js';
import { parsePagination, paginatedResponse, pick } from '../../lib/pagination.js';
import {
  syncResourceBindings, recordInitialAssignments, bumpIpRisk,
} from '../../lib/resourceBindings.js';
import { serializeRecoveryNotes, recoveryOnBanDefaults } from '../../lib/accountRecovery.js';
import {
  ACCOUNT_SELECT,
  ACCOUNT_SELECT_FULL,
  ACCOUNT_SELECT_WITH_SIM_LOCATION,
} from '../../lib/accountSelect.js';
import { enrichAccountsIpEmbed } from '../../lib/accountEnrich.js';

const router = Router();
router.use(authenticate);
router.use((req, res, next) => {
  const isStandbyPoolList =
    req.method === 'GET'
    && (req.path === '/' || req.path === '')
    && req.query.status === 'AVAILABLE';
  if (isStandbyPoolList) {
    return requireRole('admin', 'operator', 'business')(req, res, next);
  }
  return requireRole('admin', 'operator')(req, res, next);
});

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

// GET /accounts
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
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
    res.json(paginatedResponse(enriched, count || 0, page, limit));
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

    const { data: history } = await supabaseAdmin
      .from('account_status_history')
      .select('*, profiles(full_name)')
      .eq('account_id', req.params.id)
      .order('changed_at', { ascending: false });

    res.json({ ...data, statusHistory: history || [] });
  } catch (e) {
    next(e);
  }
});

// POST /accounts
router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
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

    for (const field of ['device_id', 'sim_id', 'ip_id']) {
      if (body[field] !== undefined && body[field] !== current[field]) {
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
    } else {
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
