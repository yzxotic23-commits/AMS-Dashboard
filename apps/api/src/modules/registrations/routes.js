import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { parsePagination, paginatedResponse } from '../../lib/pagination.js';
import { parseOperatorMeta } from '../../lib/accountMeta.js';
import { supplyTargetFor } from '../../lib/supplyTargets.js';
import { isPreparedQueueSim } from '../../lib/simMeta.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator'));

const logSchema = z.object({
  phone_number: z.string().min(1),
  telco: z.string().optional().nullable(),
  site_key: z.string().optional().nullable(),
  result: z.enum(['ok', 'fail']),
  fail_reason: z.string().optional().nullable(),
  account_id: z.string().uuid().optional().nullable(),
  device_id: z.string().uuid().optional().nullable(),
  ip_id: z.string().uuid().optional().nullable(),
  account_name: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  proxy_ip: z.string().optional().nullable(),
  proxy_port: z.string().optional().nullable(),
  proxy_username: z.string().optional().nullable(),
  proxy_password: z.string().optional().nullable(),
});

const META_PREFIX = '_ams_prep:';

function parsePreparedMeta(notes) {
  if (!notes) return {};
  const idx = notes.indexOf(META_PREFIX);
  if (idx === -1) return {};
  try {
    return JSON.parse(notes.slice(idx + META_PREFIX.length));
  } catch {
    return {};
  }
}

function mapPreparedSim(sim, supplyFlags = {}) {
  const meta = parsePreparedMeta(sim.notes);
  const siteKey = meta.site_key || 'my';
  const supplyNeed = supplyFlags[siteKey]?.registering_below_target;
  const need = meta.need === false ? false : (meta.need !== false || supplyNeed);
  const note = meta.note || (supplyNeed ? 'Supply: registration pipeline below target' : '');
  return {
    id: sim.id,
    phone: sim.phone_number,
    telco: sim.carrier || '—',
    need,
    note,
    site_key: siteKey,
    supply_flagged: Boolean(supplyNeed && meta.need !== false),
  };
}

async function loadSupplyFlags() {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('status, notes')
    .eq('status', 'REGISTERING');
  if (error) throw error;

  const counts = { my: 0, pp: 0 };
  (data || []).forEach((row) => {
    const sk = parseOperatorMeta(row).site_key === 'pp' ? 'pp' : 'my';
    counts[sk] += 1;
  });

  return {
    my: { registering_below_target: counts.my < supplyTargetFor('my', 'REGISTERING') },
    pp: { registering_below_target: counts.pp < supplyTargetFor('pp', 'REGISTERING') },
  };
}

// GET /registrations/prepared — SIMs waiting for registration (no active account)
router.get('/prepared', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    const { data, error } = await supabaseAdmin
      .from('sims')
      .select('*')
      .is('current_account_id', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const supplyFlags = await loadSupplyFlags();

    const rows = (data || [])
      .filter((sim) => isPreparedQueueSim(sim.notes))
      .map((sim) => mapPreparedSim(sim, supplyFlags))
      .filter((row) => !siteKey || siteKey === 'all' || row.site_key === siteKey);

    const grouped = { my: [], pp: [] };
    rows.forEach((row) => {
      const key = row.site_key === 'pp' ? 'pp' : 'my';
      grouped[key].push(row);
    });

    res.json({ data: grouped, count: rows.length });
  } catch (e) {
    next(e);
  }
});

const preparedCreateSchema = z.object({
  phone_number: z.string().min(1),
  telco: z.string().optional().nullable(),
  site_key: z.enum(['my', 'pp']).optional(),
  note: z.string().optional().nullable(),
  need: z.boolean().optional(),
});

// POST /registrations/prepared — add a number to the registration queue
router.post('/prepared', async (req, res, next) => {
  try {
    const body = preparedCreateSchema.parse(req.body);
    const meta = {
      prepared: true,
      need: body.need !== false,
      site_key: body.site_key || 'my',
      note: body.note?.trim() || '',
    };
    const notes = `${META_PREFIX}${JSON.stringify(meta)}`;

    const { data, error } = await supabaseAdmin
      .from('sims')
      .insert({
        phone_number: body.phone_number.trim(),
        carrier: body.telco?.trim() || null,
        status: 'OK',
        notes,
      })
      .select()
      .single();
    if (error) throw error;

    await writeAudit({
      entityType: 'sim',
      entityId: data.id,
      action: 'CREATE',
      newValue: { phone_number: data.phone_number, carrier: data.carrier },
      metadata: { prepared_queue: true, ...meta },
      userId: req.profile.id,
      req,
    });

    res.status(201).json(mapPreparedSim(data, await loadSupplyFlags()));
  } catch (e) {
    next(e);
  }
});

// PATCH /registrations/prepared/:id — update need flag / note on prepared SIM
router.patch('/prepared/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { need, note, site_key: siteKey } = req.body || {};

    const { data: sim, error: loadErr } = await supabaseAdmin
      .from('sims')
      .select('*')
      .eq('id', id)
      .single();
    if (loadErr) throw loadErr;

    const meta = parsePreparedMeta(sim.notes);
    const nextMeta = {
      ...meta,
      prepared: true,
      ...(need !== undefined ? { need: Boolean(need) } : {}),
      ...(note !== undefined ? { note: String(note) } : {}),
      ...(siteKey ? { site_key: siteKey } : {}),
    };
    const human = (sim.notes || '').replace(new RegExp(`${META_PREFIX}[\\s\\S]*$`), '').trim();
    const notes = human
      ? `${human}\n${META_PREFIX}${JSON.stringify(nextMeta)}`
      : `${META_PREFIX}${JSON.stringify(nextMeta)}`;

    const { data, error } = await supabaseAdmin
      .from('sims')
      .update({ notes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    res.json(mapPreparedSim(data, await loadSupplyFlags()));
  } catch (e) {
    next(e);
  }
});

// DELETE /registrations/prepared/:id — remove from queue (wrong / stale entry)
router.delete('/prepared/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: sim, error: loadErr } = await supabaseAdmin
      .from('sims')
      .select('*')
      .eq('id', id)
      .single();
    if (loadErr) throw loadErr;

    if (sim.current_account_id) {
      return res.status(409).json({ error: 'Cannot delete — number is linked to an account' });
    }

    const { count: accountRefs } = await supabaseAdmin
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('sim_id', id);
    if (accountRefs > 0) {
      return res.status(409).json({ error: 'Cannot delete — number is referenced by an account' });
    }

    const { error } = await supabaseAdmin.from('sims').delete().eq('id', id);
    if (error) throw error;

    await writeAudit({
      entityType: 'sim',
      entityId: id,
      action: 'DELETE',
      previousValue: { phone_number: sim.phone_number, carrier: sim.carrier },
      metadata: { prepared_queue: true, ...parsePreparedMeta(sim.notes) },
      userId: req.profile.id,
      req,
    });

    res.json({ ok: true, phone_number: sim.phone_number });
  } catch (e) {
    next(e);
  }
});

// GET /registrations — registration attempt log (success + fail)
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    let q = supabaseAdmin
      .from('audit_logs')
      .select('*, profiles(full_name, email)', { count: 'exact' })
      .eq('entity_type', 'account')
      .contains('metadata', { registration_log: true })
      .order('created_at', { ascending: false });

    if (req.query.result) {
      q = q.eq('metadata->>result', req.query.result);
    }

    const { data, error, count } = await q.range(offset, offset + limit - 1);
    if (error) throw error;

    const rows = (data || []).map((row) => ({
      id: row.id,
      phone_number: row.metadata?.phone_number || row.new_value?.phone_number,
      telco: row.metadata?.telco,
      site_key: row.metadata?.site_key,
      result: row.metadata?.result,
      fail_reason: row.metadata?.fail_reason,
      account_id: row.entity_id,
      account_name: row.metadata?.account_name || row.new_value?.account_name,
      proxy_ip: row.metadata?.proxy_ip,
      proxy_port: row.metadata?.proxy_port,
      proxy_username: row.metadata?.proxy_username,
      proxy_password: row.metadata?.proxy_password,
      created_at: row.created_at,
      operator: row.profiles?.full_name || row.profiles?.email || '—',
    }));

    res.json(paginatedResponse(rows, count || 0, page, limit));
  } catch (e) {
    next(e);
  }
});

// GET /registrations/stats — success rate for registration logging (Feature 2)
router.get('/stats', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key;
    let q = supabaseAdmin
      .from('audit_logs')
      .select('metadata')
      .eq('entity_type', 'account')
      .contains('metadata', { registration_log: true });

    const { data, error } = await q;
    if (error) throw error;

    let rows = (data || []).map((r) => r.metadata).filter(Boolean);
    if (siteKey && siteKey !== 'all') {
      rows = rows.filter((m) => m.site_key === siteKey);
    }

    const total = rows.length;
    const success = rows.filter((m) => m.result === 'ok').length;
    const failed = rows.filter((m) => m.result === 'fail').length;
    const rate = total > 0 ? Math.round((success / total) * 1000) / 10 : 0;

    const byReason = {};
    rows.filter((m) => m.result === 'fail').forEach((m) => {
      const r = m.fail_reason || 'Other';
      byReason[r] = (byReason[r] || 0) + 1;
    });

    res.json({
      total,
      success,
      failed,
      successRate: rate,
      failReasons: Object.entries(byReason)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    next(e);
  }
});

// POST /registrations — mandatory log for every registration attempt
router.post('/', async (req, res, next) => {
  try {
    const body = logSchema.parse(req.body);
    const metadata = {
      registration_log: true,
      phone_number: body.phone_number,
      telco: body.telco,
      site_key: body.site_key,
      result: body.result,
      fail_reason: body.fail_reason,
      account_name: body.account_name,
      remark: body.remark,
      proxy_ip: body.proxy_ip,
      proxy_port: body.proxy_port,
      proxy_username: body.proxy_username,
      proxy_password: body.proxy_password,
    };

    await writeAudit({
      entityType: 'account',
      entityId: body.account_id || null,
      action: body.result === 'ok' ? 'CREATE' : 'UPDATE',
      newValue: body.result === 'ok' ? { account_name: body.account_name, phone_number: body.phone_number } : null,
      metadata,
      userId: req.profile.id,
      req,
    });

    res.status(201).json({ ok: true, ...metadata, created_at: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});

export default router;
