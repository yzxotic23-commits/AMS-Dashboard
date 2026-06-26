import { supabaseAdmin } from './supabase.js';
import { parseOperatorMeta } from './accountMeta.js';
import { buildBanRecords } from './banAnalytics.js';
import { ACCOUNT_SELECT_BAN } from './accountSelect.js';
import {
  RM_DEFAULTS,
  computeRmSupply,
  buildRmDiagnosis,
  formatRmNeedNote,
} from './rmSupplyModel.js';

const REC_PREFIX = '_ams_rec:';
const LOOKBACK_DAYS = 30;

function parseRecoveryMeta(notes) {
  const idx = (notes || '').indexOf(REC_PREFIX);
  if (idx === -1) return null;
  try {
    return JSON.parse(notes.slice(idx + REC_PREFIX.length));
  } catch {
    return null;
  }
}

function siteOfAccount(row) {
  const sk = parseOperatorMeta(row).site_key;
  return sk === 'pp' ? 'pp' : 'my';
}

function filterSite(rows, siteKey) {
  if (!siteKey || siteKey === 'all') return rows;
  return rows.filter((r) => siteOfAccount(r) === siteKey);
}

async function loadAccounts() {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('id, status, notes')
    .limit(2000);
  if (error) throw error;
  return data || [];
}

async function loadBanRecords(siteKey) {
  const { data: history } = await supabaseAdmin
    .from('account_status_history')
    .select('*, profiles(full_name)')
    .eq('to_status', 'BANNED')
    .order('changed_at', { ascending: false })
    .limit(500);
  const accountIds = [...new Set((history || []).map((h) => h.account_id))];
  let accountsById = {};
  if (accountIds.length) {
    const { data: accounts } = await supabaseAdmin
      .from('accounts')
      .select(ACCOUNT_SELECT_BAN)
      .in('id', accountIds);
    accountsById = Object.fromEntries((accounts || []).map((a) => {
      const meta = parseOperatorMeta(a);
      return [a.id, { ...a, site_key: meta.site_key || 'my', channel: meta.channel || '' }];
    }));
  }
  const records = buildBanRecords(history || [], accountsById);
  return filterSite(records, siteKey);
}

async function loadRegistrationRates(siteKey) {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('metadata')
    .eq('entity_type', 'account')
    .contains('metadata', { registration_log: true });
  if (error) throw error;
  let rows = (data || []).map((r) => r.metadata).filter(Boolean);
  if (siteKey && siteKey !== 'all') {
    rows = rows.filter((m) => (m.site_key || 'my') === siteKey);
  }
  const total = rows.length;
  const failed = rows.filter((m) => m.result === 'fail').length;
  if (total === 0) return { Fr: RM_DEFAULTS.Fr / 100, total: 0 };
  return { Fr: failed / total, total };
}

async function loadRecoveryRates(siteKey) {
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('id, notes, status')
    .in('status', ['BANNED', 'RECOVERING', 'RECYCLED', 'AVAILABLE', 'NURTURING']);
  if (error) throw error;

  const durations = [];
  let completed = 0;
  let success = 0;

  (data || []).forEach((a) => {
    if (siteKey && siteKey !== 'all' && siteOfAccount(a) !== siteKey) return;
    const rec = parseRecoveryMeta(a.notes);
    if (!rec?.log?.length) return;
    const need = rec.log.find((l) => l.st === 'need');
    const ok = rec.log.find((l) => l.st === 'ok');
    const fail = rec.log.find((l) => l.st === 'fail');
    if (ok || fail) {
      completed += 1;
      if (ok) success += 1;
    }
    if (need && ok) {
      const t0 = new Date(need.time).getTime();
      const t1 = new Date(ok.time).getTime();
      if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) {
        durations.push((t1 - t0) / 86400000);
      }
    }
  });

  const R = completed > 0 ? success / completed : RM_DEFAULTS.R / 100;
  const Tr = durations.length
    ? durations.reduce((n, d) => n + d, 0) / durations.length
    : RM_DEFAULTS.Tr;

  return { R, Tr, completed, success };
}

function dailyBanRateOnPool(banRecords, poolSize, fromStatus) {
  if (!poolSize) return RM_DEFAULTS.D / 100;
  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
  const recent = banRecords.filter((r) => {
    if (fromStatus && r.from_status !== fromStatus) return false;
    return new Date(r.changed_at).getTime() >= cutoff;
  });
  const daily = recent.length / LOOKBACK_DAYS;
  const pct = (daily / poolSize) * 100;
  return pct > 0 ? Math.min(1, pct / 100) : RM_DEFAULTS.D / 100;
}

function countByStatus(accounts, siteKey) {
  const filtered = filterSite(accounts, siteKey);
  const counts = { REGISTERING: 0, NURTURING: 0, AVAILABLE: 0, IN_USE: 0, RECOVERING: 0 };
  filtered.forEach((a) => {
    if (counts[a.status] !== undefined) counts[a.status] += 1;
  });
  return counts;
}

export async function loadRmSupplyModel(siteKey = 'all') {
  const sites = siteKey === 'all' ? ['my', 'pp'] : [siteKey];
  const accounts = await loadAccounts();

  const bySite = {};
  for (const sk of sites) {
    const counts = countByStatus(accounts, sk);
    const inUse = counts.IN_USE;
    const nurturing = counts.NURTURING;
    const registering = counts.REGISTERING;

    const banRecords = await loadBanRecords(sk);
    const { Fr, total: regAttempts } = await loadRegistrationRates(sk);
    const { R, Tr, completed: recCompleted, success: recSuccess } = await loadRecoveryRates(sk);

    const D = dailyBanRateOnPool(banRecords, inUse, 'IN_USE');
    const Wf = dailyBanRateOnPool(banRecords, Math.max(nurturing, 1), 'NURTURING');

    const inputs = {
      D: Math.round(D * 1000) / 10,
      R: Math.round(R * 1000) / 10,
      Wf: Math.round(Wf * 1000) / 10,
      Fr: Math.round(Fr * 1000) / 10,
      W: RM_DEFAULTS.W,
      Tr: Math.round(Tr * 10) / 10,
      active: inUse,
      registering,
      nurturing,
      regAttempts,
      recCompleted,
      recSuccess,
      lookbackDays: LOOKBACK_DAYS,
    };

    const calc = computeRmSupply({
      active: inUse || 1,
      D: D,
      R: R,
      Wf: Wf,
      Fr: Fr,
      W: RM_DEFAULTS.W,
      Tr: Tr,
    });

    const diagnosis = buildRmDiagnosis({
      D,
      R,
      Wf,
      Fr,
      yieldPct: calc.yield,
      warm: nurturing,
      toWarm: calc.toWarm,
      W: RM_DEFAULTS.W,
      Tr,
    });

    bySite[sk] = {
      site_key: sk,
      inputs,
      ...calc,
      nurturingTarget: calc.warm,
      registeringTarget: calc.regDaily,
      diagnosis,
      needNote: formatRmNeedNote({ regDaily: calc.regDaily, yield: calc.yield, inputs }),
      registering,
    };
  }

  if (siteKey === 'all') {
    return { site_key: 'all', sites: bySite };
  }
  return { site_key: siteKey, ...bySite[siteKey] };
}

export async function loadRmSupplyFlagsBySite() {
  const { sites } = await loadRmSupplyModel('all');
  return {
    my: sites.my,
    pp: sites.pp,
  };
}
