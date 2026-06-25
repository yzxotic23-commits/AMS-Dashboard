import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { parsePagination, paginatedResponse } from '../../lib/pagination.js';
import {
  expiryFromChargeDate,
  mapSimRow,
  mergeSimLedgerMeta,
  resolveBoundAccount,
  simLedgerEligible,
} from '../../lib/simMeta.js';

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
});

const EMPTY_PHONE_MAP = new Map();

/** Ledger list — bind via sim_id / current_account_id only (skip slow phone OR scan). */
async function loadSimAccountMapsLite(simRows) {
  const simIds = simRows.map((s) => s.id).filter(Boolean);
  const currentIds = simRows.map((s) => s.current_account_id).filter(Boolean);
  const accountBySimId = new Map();
  const accountByCurrentId = new Map();

  if (simIds.length) {
    const { data } = await supabaseAdmin
      .from('accounts')
      .select('id, account_name, sim_id, phone_number')
      .in('sim_id', simIds);
    (data || []).forEach((a) => {
      if (a.sim_id) accountBySimId.set(a.sim_id, a);
    });
  }
  if (currentIds.length) {
    const { data } = await supabaseAdmin
      .from('accounts')
      .select('id, account_name, phone_number')
      .in('id', currentIds);
    (data || []).forEach((a) => accountByCurrentId.set(a.id, a));
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
    const { data } = await supabaseAdmin
      .from('accounts')
      .select('id, account_name, sim_id, phone_number')
      .in('sim_id', simIds);
    (data || []).forEach((a) => {
      if (a.sim_id) accountBySimId.set(a.sim_id, a);
    });
  }
  if (currentIds.length) {
    const { data } = await supabaseAdmin
      .from('accounts')
      .select('id, account_name, phone_number')
      .in('id', currentIds);
    (data || []).forEach((a) => accountByCurrentId.set(a.id, a));
  }

  const phoneDigitsList = [...new Set(
    simRows.map((s) => String(s.phone_number || '').replace(/\D/g, '')).filter(Boolean),
  )];
  if (phoneDigitsList.length) {
    const orParts = phoneDigitsList.flatMap((d) => [
      `phone_number.ilike.%${d}%`,
      `phone_number.ilike.%${d.slice(-9)}%`,
    ]);
    const { data } = await supabaseAdmin
      .from('accounts')
      .select('id, account_name, phone_number, sim_id')
      .or(orParts.join(','));
    (data || []).forEach((a) => {
      const digits = String(a.phone_number || '').replace(/\D/g, '');
      if (digits) accountByPhoneDigits.set(digits, a);
      if (digits.length >= 9) accountByPhoneDigits.set(digits.slice(-9), a);
    });
  }

  return { accountBySimId, accountByCurrentId, accountByPhoneDigits };
}

function filterLedgerRows(simRows, maps, siteKey) {
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
    const allLedgerRows = filterLedgerRows(data, maps, siteKey);
    const total = allLedgerRows.length;
    const rows = allLedgerRows.slice(offset, offset + limit);
    res.set('Cache-Control', 'private, max-age=15');
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
    const body = updateSchema.parse(req.body);
    const { data: current, error: readErr } = await supabaseAdmin
      .from('sims')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (readErr) throw readErr;

    const patch = { ...body };
    delete patch.last_charged;

    if (body.last_charged) {
      patch.notes = mergeSimLedgerMeta(current.notes, { last_charged: body.last_charged });
      patch.expiry_date = expiryFromChargeDate(body.last_charged);
      patch.status = patch.status || 'OK';
    }

    const { data, error } = await supabaseAdmin
      .from('sims')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    await writeAudit({
      entityType: 'sim',
      entityId: data.id,
      action: 'UPDATE',
      previousValue: current,
      newValue: data,
      metadata: body.last_charged ? { last_charged: body.last_charged, expiry_date: patch.expiry_date } : undefined,
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
