import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { parseOperatorMeta } from '../../lib/accountMeta.js';
import { SUPPLY_LABELS, supplyTargetFor } from '../../lib/supplyTargets.js';
import { loadRmSupplyModel } from '../../lib/rmSupplyData.js';
import {
  defaultRmSupplySettings,
  loadRmSupplySettings,
  normalizeRmSupplySettings,
  saveRmSupplySettings,
} from '../../lib/rmSupplySettings.js';
import {
  applyPhoneSync,
  buildPhoneSyncRow,
  phoneDigits,
  phonesMatch,
  syncIssueType,
} from '../../lib/phoneSync.js';
import { accountInBrandScope, profileBrandScope } from '../../lib/accountBrand.js';

const router = Router();
router.use(authenticate);

function filterBySite(rows, siteKey) {
  if (!siteKey || siteKey === 'all') return rows;
  return rows.filter((a) => parseOperatorMeta(a).site_key === siteKey);
}

function filterByBrand(rows, profile) {
  const scope = profileBrandScope(profile);
  if (!scope) return rows;
  if (!scope.length) return [];
  return rows.filter((a) => accountInBrandScope(a, scope));
}

// GET /supply — pool counts vs targets (REGISTERING/NURTURING targets from RM model)
// Business may read brand-scoped counts for Governance dashboard.
router.get('/', requireRole('admin', 'operator', 'business'), async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key || 'all';
    const [{ data: accounts, error }, rm] = await Promise.all([
      supabaseAdmin.from('accounts').select('id, status, notes, account_name, device_id').limit(1000),
      loadRmSupplyModel(siteKey),
    ]);
    if (error) throw error;

    let filtered = filterBySite(accounts || [], siteKey);
    filtered = filterByBrand(filtered, req.profile);
    const counts = { REGISTERING: 0, NURTURING: 0, AVAILABLE: 0, IN_USE: 0 };
    filtered.forEach((a) => {
      if (counts[a.status] !== undefined) counts[a.status] += 1;
    });

    const rmTargets = siteKey === 'all'
      ? {
        REGISTERING: (rm.sites?.my?.registeringTarget || 0) + (rm.sites?.pp?.registeringTarget || 0),
        NURTURING: (rm.sites?.my?.nurturingTarget || 0) + (rm.sites?.pp?.nurturingTarget || 0),
      }
      : {
        REGISTERING: rm.registeringTarget || 0,
        NURTURING: rm.nurturingTarget || 0,
      };

    const pools = Object.keys(SUPPLY_LABELS).map((status) => {
      const cur = counts[status] || 0;
      const name = SUPPLY_LABELS[status];
      if (status === 'AVAILABLE') {
        return { status, name, current: cur, count_only: true };
      }
      const target = status === 'REGISTERING' || status === 'NURTURING'
        ? (rmTargets[status] || supplyTargetFor(siteKey, status))
        : supplyTargetFor(siteKey, status);
      const pct = target ? Math.round((cur / target) * 100) : 0;
      return {
        status,
        name,
        current: cur,
        target,
        pct,
        gap: target - cur,
        healthy: pct >= 80,
        count_only: false,
        rm_target: status === 'REGISTERING' || status === 'NURTURING',
      };
    });

    const totalCurrent = pools.reduce((n, p) => n + p.current, 0);
    const totalTarget = pools.reduce((n, p) => n + (p.count_only ? 0 : (p.target || 0)), 0);

    res.json({
      site_key: siteKey,
      pools,
      rm: siteKey === 'all' ? rm.sites : rm,
      is_live_snapshot: true,
      snapshot_note: 'Live count as of now',
      summary: {
        total_current: totalCurrent,
        total_target: totalTarget,
        overall_pct: totalTarget ? Math.round((totalCurrent / totalTarget) * 100) : 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.use(requireRole('admin', 'operator'));
// GET /supply/rm-model — RM Operation Logic v3.2 calculation
router.get('/rm-model', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key || 'all';
    const model = await loadRmSupplyModel(siteKey);
    res.json(model);
  } catch (e) {
    next(e);
  }
});

const rmSettingsSchema = z.object({
  my: z.object({
    sources: z.record(z.enum(['live', 'manual'])).optional(),
    manual: z.record(z.coerce.number()).optional(),
  }).optional(),
  pp: z.object({
    sources: z.record(z.enum(['live', 'manual'])).optional(),
    manual: z.record(z.coerce.number()).optional(),
  }).optional(),
});

// GET /supply/rm-settings — RM formula config (admin)
router.get('/rm-settings', requireRole('admin'), async (_req, res, next) => {
  try {
    const [config, model] = await Promise.all([
      loadRmSupplySettings(),
      loadRmSupplyModel('all'),
    ]);
    res.json({ config, model });
  } catch (e) {
    next(e);
  }
});

// PATCH /supply/rm-settings
router.patch('/rm-settings', requireRole('admin'), async (req, res, next) => {
  try {
    const body = rmSettingsSchema.parse(req.body);
    const prev = await loadRmSupplySettings();
    const merged = normalizeRmSupplySettings({
      my: {
        ...prev.my,
        ...body.my,
        sources: { ...prev.my?.sources, ...body.my?.sources },
        manual: { ...prev.my?.manual, ...body.my?.manual },
      },
      pp: {
        ...prev.pp,
        ...body.pp,
        sources: { ...prev.pp?.sources, ...body.pp?.sources },
        manual: { ...prev.pp?.manual, ...body.pp?.manual },
      },
    });
    const config = await saveRmSupplySettings(merged, req.user.id);
    const model = await loadRmSupplyModel('all');

    await writeAudit({
      entityType: 'app_settings',
      entityId: null,
      action: 'RM_SUPPLY_UPDATE',
      previousValue: prev,
      newValue: config,
      userId: req.user.id,
      req,
    });

    res.json({ config, model });
  } catch (e) {
    next(e);
  }
});

// POST /supply/rm-settings/reset
router.post('/rm-settings/reset', requireRole('admin'), async (req, res, next) => {
  try {
    const prev = await loadRmSupplySettings();
    const config = await saveRmSupplySettings(defaultRmSupplySettings(), req.user.id);
    const model = await loadRmSupplyModel('all');

    await writeAudit({
      entityType: 'app_settings',
      entityId: null,
      action: 'RM_SUPPLY_RESET',
      previousValue: prev,
      newValue: config,
      userId: req.user.id,
      req,
    });

    res.json({ config, model });
  } catch (e) {
    next(e);
  }
});

async function loadPhoneSyncCandidates(siteKey) {
  const [{ data: accounts, error: accErr }, { data: sims, error: simErr }] = await Promise.all([
    supabaseAdmin.from('accounts').select('id, account_name, phone_number, status, sim_id, notes').limit(500),
    supabaseAdmin.from('sims').select('id, phone_number, carrier, current_account_id').limit(500),
  ]);
  if (accErr) throw accErr;
  if (simErr) throw simErr;

  const siteAccounts = filterBySite(accounts || [], siteKey);
  const simById = new Map((sims || []).map((s) => [s.id, s]));
  const simByPhone = new Map();
  (sims || []).forEach((s) => {
    const d = phoneDigits(s.phone_number);
    if (d) {
      simByPhone.set(d, s);
      if (d.length >= 9) simByPhone.set(d.slice(-9), s);
    }
  });

  const rows = [];
  const seen = new Set();

  siteAccounts.forEach((account) => {
    const sim = account.sim_id ? simById.get(account.sim_id) : null;
    let matchSim = sim;
    if (!matchSim && account.phone_number) {
      const digits = phoneDigits(account.phone_number);
      matchSim = simByPhone.get(digits) || simByPhone.get(digits.slice(-9)) || null;
    }
    const issue = syncIssueType(account, matchSim);
    if (issue !== 'ok') {
      rows.push(buildPhoneSyncRow(account, matchSim));
      seen.add(account.id);
    }
  });

  (sims || []).forEach((sim) => {
    if (!sim.current_account_id) return;
    const account = siteAccounts.find((a) => a.id === sim.current_account_id);
    if (!account) {
      rows.push(buildPhoneSyncRow(null, sim));
      return;
    }
    if (seen.has(account.id)) return;
    const issue = syncIssueType(account, sim);
    if (issue !== 'ok') rows.push(buildPhoneSyncRow(account, sim));
  });

  return rows.sort((a, b) => Number(b.needs_action) - Number(a.needs_action));
}

// GET /supply/phone-sync — rows needing phone/SIM alignment
router.get('/phone-sync', async (req, res, next) => {
  try {
    const siteKey = req.query.site || req.query.site_key || 'all';
    const rows = await loadPhoneSyncCandidates(siteKey);
    res.json({
      data: rows,
      mismatch_count: rows.filter((r) => r.needs_action).length,
    });
  } catch (e) {
    next(e);
  }
});

const syncSchema = z.object({
  action: z.enum(['copy_sim_to_account', 'copy_account_to_sim', 'link_sim']),
  sim_id: z.string().uuid().optional(),
});

// POST /supply/phone-sync/:accountId
router.post('/phone-sync/:accountId', async (req, res, next) => {
  try {
    const body = syncSchema.parse(req.body);
    const { data: account, error: accErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();
    if (accErr || !account) return res.status(404).json({ error: 'Account not found' });

    let sim = null;
    const simId = body.sim_id || account.sim_id;
    if (simId) {
      const { data, error } = await supabaseAdmin.from('sims').select('*').eq('id', simId).single();
      if (error) throw error;
      sim = data;
    } else if (body.action !== 'link_sim') {
      return res.status(400).json({ error: 'sim_id required' });
    }

    const result = await applyPhoneSync(supabaseAdmin, {
      account,
      sim,
      action: body.action,
      userId: req.user.id,
    });

    await writeAudit({
      entityType: 'account',
      entityId: account.id,
      action: 'PHONE_SYNC',
      metadata: { action: body.action, sim_id: result.sim_id },
      userId: req.user.id,
      req,
    });

    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

export default router;
