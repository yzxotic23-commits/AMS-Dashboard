import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { parsePagination, paginatedResponse } from '../../lib/pagination.js';
import {
  appendSimTopup,
  listSimTopups,
  mapSimRow,
  normalizeLedgerStatus,
  refundSimTopup,
  resolveBoundAccount,
  SIM_EXCEPTION_REASONS,
  SIM_LEDGER_STATUSES,
  SIM_TOPUP_CYCLE_OPTIONS,
  simLedgerEligible,
} from '../../lib/simMeta.js';
import {
  buildExceptionPatch,
  buildRemarkPatch,
  buildTopupEntry,
  listSimTopupsForSim,
  loadTopupCounts,
  mapTopupRow,
} from '../../lib/simLedgerDb.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator'));

const createSchema = z.object({
  phone_number: z.string().min(1),
  carrier: z.string().optional().nullable(),
  expiry_date: z.string().optional().nullable(),
  balance: z.number().optional().nullable(),
  status: z.enum(['OK', 'LOW_BALANCE', 'EXPIRING', 'EXPIRED', 'CANCELLED']).optional(),
  notes: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  last_charged: z.string().optional().nullable(),
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  cycle_days: z.union([z.number(), z.string()]).optional().nullable(),
  plan: z.string().optional().nullable(),
  ledger_status: z.enum(['active', 'pending_review', 'stop_topup']).optional().nullable(),
  remark: z.string().optional().nullable(),
});

const exceptionSchema = z.object({
  reason: z.enum(['topup_failed', 'number_suspended', 'account_ban_pending']),
  detail: z.string().optional().nullable(),
});

const refundSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  reason: z.string().optional().nullable(),
});

function actorName(profile) {
  return profile?.full_name || profile?.email || profile?.id || null;
}

const EMPTY_PHONE_MAP = new Map();

// Keep selects embed-free for ledger maps — brand comes from account notes meta.
// (Embedding devices() is ambiguous: accounts.device_id vs devices.current_account_id.)
const ACCOUNT_SIM_SELECT = 'id, account_name, sim_id, phone_number, notes, device_id';

function normalizeAccountRow(a) {
  if (!a) return a;
  return {
    ...a,
    device_name: a.devices?.device_name || a.device_name || null,
  };
}

async function selectAccounts(filter) {
  let q = supabaseAdmin.from('accounts').select(ACCOUNT_SIM_SELECT);
  if (filter.simIds) q = q.in('sim_id', filter.simIds);
  if (filter.ids) q = q.in('id', filter.ids);
  if (filter.or) q = q.or(filter.or);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Optional device names for brand inference when meta.brand is missing. */
async function attachDeviceNames(accounts) {
  const deviceIds = [...new Set(accounts.map((a) => a.device_id).filter(Boolean))];
  if (!deviceIds.length) return accounts.map(normalizeAccountRow);
  const { data, error } = await supabaseAdmin
    .from('devices')
    .select('id, device_name')
    .in('id', deviceIds);
  if (error) throw error;
  const byId = new Map((data || []).map((d) => [d.id, d.device_name]));
  return accounts.map((a) => normalizeAccountRow({
    ...a,
    device_name: byId.get(a.device_id) || null,
  }));
}

/** Ledger list — bind via sim_id / current_account_id only (skip slow phone OR scan). */
async function loadSimAccountMapsLite(simRows) {
  const simIds = simRows.map((s) => s.id).filter(Boolean);
  const currentIds = simRows.map((s) => s.current_account_id).filter(Boolean);
  const accountBySimId = new Map();
  const accountByCurrentId = new Map();

  if (simIds.length) {
    const data = await attachDeviceNames(await selectAccounts({ simIds }));
    data.forEach((a) => {
      if (a.sim_id) accountBySimId.set(a.sim_id, a);
    });
  }
  if (currentIds.length) {
    const data = await attachDeviceNames(await selectAccounts({ ids: currentIds }));
    data.forEach((a) => accountByCurrentId.set(a.id, a));
  }

  return { accountBySimId, accountByCurrentId, accountByPhoneDigits: EMPTY_PHONE_MAP };
}

async function loadSimAccountMapsFull(simRows) {
  const simIds = simRows.map((s) => s.id).filter(Boolean);
  const currentIds = simRows.map((s) => s.current_account_id).filter(Boolean);
  const accountBySimId = new Map();
  const accountByCurrentId = new Map();
  const accountByPhoneDigits = new Map();

  if (simIds.length) {
    const data = await attachDeviceNames(await selectAccounts({ simIds }));
    data.forEach((a) => {
      if (a.sim_id) accountBySimId.set(a.sim_id, a);
    });
  }
  if (currentIds.length) {
    const data = await attachDeviceNames(await selectAccounts({ ids: currentIds }));
    data.forEach((a) => accountByCurrentId.set(a.id, a));
  }

  const phoneDigitsList = [...new Set(
    simRows.map((s) => String(s.phone_number || '').replace(/\D/g, '')).filter(Boolean),
  )];
  if (phoneDigitsList.length) {
    const orParts = phoneDigitsList.flatMap((d) => [
      `phone_number.ilike.%${d}%`,
      `phone_number.ilike.%${d.slice(-9)}%`,
    ]);
    const data = await attachDeviceNames(await selectAccounts({ or: orParts.join(',') }));
    data.forEach((a) => {
      const digits = String(a.phone_number || '').replace(/\D/g, '');
      if (digits) accountByPhoneDigits.set(digits, a);
      if (digits.length >= 9) accountByPhoneDigits.set(digits.slice(-9), a);
    });
  }

  return { accountBySimId, accountByCurrentId, accountByPhoneDigits };
}

function filterLedgerRows(simRows, maps, siteKey, topupCountBySimId = new Map()) {
  return (simRows || [])
    .map((sim) => {
      const boundAccount = resolveBoundAccount(
        sim,
        maps.accountBySimId,
        maps.accountByCurrentId,
        maps.accountByPhoneDigits,
      );
      if (!simLedgerEligible(sim, boundAccount)) return null;
      const row = mapSimRow(
        sim,
        maps.accountBySimId,
        maps.accountByCurrentId,
        maps.accountByPhoneDigits,
        topupCountBySimId,
      );
      if (siteKey && siteKey !== 'all' && row.site_key !== siteKey) return null;
      return row;
    })
    .filter(Boolean);
}

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const siteKey = req.query.site || req.query.site_key || 'all';
    let q = supabaseAdmin.from('sims').select('*');

    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.search) {
      q = q.or(`phone_number.ilike.%${req.query.search}%,carrier.ilike.%${req.query.search}%`);
    }

    const { data, error } = await q
      .order('updated_at', { ascending: false })
      .limit(250);
    if (error) throw error;

    const maps = await loadSimAccountMapsLite(data || []);
    const topupCounts = await loadTopupCounts((data || []).map((s) => s.id));
    const allLedgerRows = filterLedgerRows(data, maps, siteKey, topupCounts);
    const total = allLedgerRows.length;
    const rows = allLedgerRows.slice(offset, offset + limit);
    const bound = rows.filter((r) => r.account_name).length;
    // Avoid 304/ETag: axios treats empty 304 bodies as [] and RQ keeps stale dashed rows.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.removeHeader('ETag');
    res.set('X-AMS-Sim-Bound', String(bound));
    if (process.env.NODE_ENV !== 'production') {
      console.log('[sims] list bound=%s/%s sample=%s', bound, rows.length, rows[0]?.account_name || '—');
    }
    res.json(paginatedResponse(rows, total, page, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('sims').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    const maps = await loadSimAccountMapsFull([data]);
    res.json(mapSimRow(
      data,
      maps.accountBySimId,
      maps.accountByCurrentId,
      maps.accountByPhoneDigits,
    ));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/topups', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('sims').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const err = new Error('SIM not found');
      err.status = 404;
      throw err;
    }
    const maps = await loadSimAccountMapsFull([data]);
    const topups = await listSimTopupsForSim(data);
    const counts = new Map([[data.id, topups.length]]);
    const row = mapSimRow(
      data,
      maps.accountBySimId,
      maps.accountByCurrentId,
      maps.accountByPhoneDigits,
      counts,
    );
    res.json({
      sim: row,
      topups,
      cycle_options: SIM_TOPUP_CYCLE_OPTIONS,
      exception_reasons: SIM_EXCEPTION_REASONS,
      ledger_statuses: SIM_LEDGER_STATUSES,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/exception', async (req, res, next) => {
  try {
    const body = exceptionSchema.parse(req.body || {});
    const { data: current, error: readErr } = await supabaseAdmin
      .from('sims')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      const err = new Error('SIM not found');
      err.status = 404;
      throw err;
    }

    const recorded = buildExceptionPatch({
      reason: body.reason,
      detail: body.detail,
      created_by: actorName(req.profile),
      current_ledger_status: current.ledger_status,
    });

    const { data: updatedRows, error } = await supabaseAdmin
      .from('sims')
      .update(recorded.patch)
      .eq('id', req.params.id)
      .select('*');
    if (error) throw error;
    const data = updatedRows?.[0];
    if (!data) {
      const err = new Error('SIM update failed — row not returned');
      err.status = 500;
      throw err;
    }

    await writeAudit({
      entityType: 'sim',
      entityId: data.id,
      action: 'UPDATE',
      previousValue: current,
      newValue: data,
      metadata: {
        kind: 'unable_to_topup',
        reason: body.reason,
        detail: body.detail || null,
        ledger_status: recorded.ledger_status,
        exception_id: recorded.entry.id,
      },
      userId: req.profile.id,
      req,
    });

    const maps = await loadSimAccountMapsFull([data]);
    res.json(mapSimRow(
      data,
      maps.accountBySimId,
      maps.accountByCurrentId,
      maps.accountByPhoneDigits,
    ));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/topups/:topupId/refund', async (req, res, next) => {
  try {
    const body = refundSchema.parse(req.body || {});
    const { data: current, error: readErr } = await supabaseAdmin
      .from('sims')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      const err = new Error('SIM not found');
      err.status = 404;
      throw err;
    }

    const actor = actorName(req.profile);
    let refundedEntry = null;
    let topups = [];

    const { data: topupRow, error: topupErr } = await supabaseAdmin
      .from('sim_topups')
      .select('*')
      .eq('sim_id', req.params.id)
      .eq('id', req.params.topupId)
      .maybeSingle();

    if (!topupErr && topupRow) {
      if (topupRow.refund) {
        const err = new Error('This top-up is already refunded');
        err.status = 400;
        throw err;
      }
      const amountNum = body.amount == null || body.amount === ''
        ? topupRow.amount
        : Number(body.amount);
      const refund = {
        amount: Number.isFinite(Number(amountNum)) ? Number(amountNum) : null,
        reason: body.reason ? String(body.reason).trim() : null,
        created_at: new Date().toISOString(),
        created_by: actor,
      };
      const { data: updatedTopup, error: updErr } = await supabaseAdmin
        .from('sim_topups')
        .update({ refund })
        .eq('id', topupRow.id)
        .select('*')
        .maybeSingle();
      if (updErr) throw updErr;
      refundedEntry = mapTopupRow(updatedTopup || { ...topupRow, refund });
      topups = await listSimTopupsForSim(current);
    } else {
      // Legacy notes fallback
      const refunded = refundSimTopup(current.notes, req.params.topupId, {
        amount: body.amount,
        reason: body.reason,
        created_by: actor,
      });
      const { data: updatedRows, error } = await supabaseAdmin
        .from('sims')
        .update({ notes: refunded.notes })
        .eq('id', req.params.id)
        .select('*');
      if (error) throw error;
      const data = updatedRows?.[0] || current;
      refundedEntry = refunded.entry;
      topups = listSimTopups(data.notes);
      const maps = await loadSimAccountMapsFull([data]);
      await writeAudit({
        entityType: 'sim',
        entityId: data.id,
        action: 'UPDATE',
        previousValue: current,
        newValue: data,
        metadata: {
          kind: 'topup_refund',
          topup_id: req.params.topupId,
          amount: refundedEntry.refund?.amount ?? null,
          reason: body.reason || null,
        },
        userId: req.profile.id,
        req,
      });
      return res.json({
        sim: mapSimRow(
          data,
          maps.accountBySimId,
          maps.accountByCurrentId,
          maps.accountByPhoneDigits,
        ),
        topup: refundedEntry,
        topups,
      });
    }

    await writeAudit({
      entityType: 'sim',
      entityId: current.id,
      action: 'UPDATE',
      previousValue: current,
      newValue: current,
      metadata: {
        kind: 'topup_refund',
        topup_id: req.params.topupId,
        amount: refundedEntry?.refund?.amount ?? null,
        reason: body.reason || null,
      },
      userId: req.profile.id,
      req,
    });

    const maps = await loadSimAccountMapsFull([current]);
    res.json({
      sim: mapSimRow(
        current,
        maps.accountBySimId,
        maps.accountByCurrentId,
        maps.accountByPhoneDigits,
        new Map([[current.id, topups.length]]),
      ),
      topup: refundedEntry,
      topups,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const { data, error } = await supabaseAdmin.from('sims').insert(body).select().single();
    if (error) throw error;
    await writeAudit({ entityType: 'sim', entityId: data.id, action: 'CREATE', newValue: data, userId: req.profile.id, req });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body || {});
    const { data: current, error: readErr } = await supabaseAdmin
      .from('sims')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      const err = new Error('SIM not found');
      err.status = 404;
      throw err;
    }

    const dbPatch = {};
    let chargeMeta;
    let statusMeta;
    let remarkMeta;
    let insertedTopup = null;
    const actor = actorName(req.profile);

    if (body.ledger_status) {
      dbPatch.ledger_status = normalizeLedgerStatus(body.ledger_status);
      statusMeta = {
        kind: 'ledger_status',
        ledger_status: dbPatch.ledger_status,
      };
    }
    if (Object.prototype.hasOwnProperty.call(body, 'remark')) {
      Object.assign(dbPatch, buildRemarkPatch(body.remark, actor));
      remarkMeta = {
        kind: 'remark',
        remark: dbPatch.remark,
      };
    }
    if (body.last_charged) {
      const entry = buildTopupEntry({
        charged_at: body.last_charged,
        amount: body.amount,
        cycle_days: body.cycle_days,
        plan: body.plan,
        created_by: actor,
        prev_cycle_days: current.last_cycle_days,
      });
      dbPatch.last_charged = entry.charged_at;
      dbPatch.last_amount = entry.amount;
      dbPatch.last_cycle_days = entry.cycle_days;
      dbPatch.last_plan = entry.plan;
      dbPatch.expiry_date = entry.expiry_date;
      dbPatch.ledger_status = 'active';
      dbPatch.status = body.status || 'OK';
      chargeMeta = {
        last_charged: entry.charged_at,
        amount: entry.amount,
        cycle_days: entry.cycle_days,
        plan: entry.plan,
        expiry_date: entry.expiry_date,
      };

      const { data: topupRow, error: topupErr } = await supabaseAdmin
        .from('sim_topups')
        .insert({
          sim_id: current.id,
          charged_at: entry.charged_at,
          amount: entry.amount,
          cycle_days: entry.cycle_days,
          plan: entry.plan,
          expiry_date: entry.expiry_date,
          created_by: actor,
        })
        .select('*')
        .maybeSingle();
      if (topupErr) {
        // Table missing → fall back to notes JSON for this charge only
        if (/relation|does not exist|schema cache/i.test(topupErr.message || '')) {
          const charged = appendSimTopup(current.notes, {
            charged_at: entry.charged_at,
            amount: entry.amount,
            cycle_days: entry.cycle_days,
            plan: entry.plan,
            created_by: actor,
          });
          dbPatch.notes = charged.notes;
          chargeMeta.topup_id = charged.entry.id;
        } else {
          throw topupErr;
        }
      } else {
        insertedTopup = mapTopupRow(topupRow);
        chargeMeta.topup_id = insertedTopup?.id || null;
      }
    } else if (body.status) {
      dbPatch.status = body.status;
    }

    if (body.carrier !== undefined) dbPatch.carrier = body.carrier;
    if (body.balance !== undefined) dbPatch.balance = body.balance;
    if (body.phone_number !== undefined) dbPatch.phone_number = body.phone_number;
    if (body.expiry_date !== undefined && dbPatch.expiry_date === undefined) {
      dbPatch.expiry_date = body.expiry_date;
    }

    if (!Object.keys(dbPatch).length) {
      const err = new Error('No valid SIM fields to update');
      err.status = 400;
      throw err;
    }

    const { data: updatedRows, error } = await supabaseAdmin
      .from('sims')
      .update(dbPatch)
      .eq('id', req.params.id)
      .select('*');
    if (error) throw error;

    const data = updatedRows?.[0];
    if (!data) {
      const err = new Error('SIM update failed — row not returned');
      err.status = 500;
      throw err;
    }

    await writeAudit({
      entityType: 'sim',
      entityId: data.id,
      action: 'UPDATE',
      previousValue: current,
      newValue: data,
      metadata: chargeMeta || statusMeta || remarkMeta,
      userId: req.profile.id,
      req,
    });

    const maps = await loadSimAccountMapsFull([data]);
    const counts = await loadTopupCounts([data.id]);
    res.json(mapSimRow(
      data,
      maps.accountBySimId,
      maps.accountByCurrentId,
      maps.accountByPhoneDigits,
      counts,
    ));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { data: current } = await supabaseAdmin.from('sims').select('*').eq('id', req.params.id).single();
    const { error } = await supabaseAdmin.from('sims').delete().eq('id', req.params.id);
    if (error) throw error;
    await writeAudit({ entityType: 'sim', entityId: req.params.id, action: 'DELETE', previousValue: current, userId: req.profile.id, req });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
