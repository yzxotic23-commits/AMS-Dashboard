import { supabaseAdmin } from './supabase.js';
import { parseOperatorMeta, parsePrefixedJsonBlock } from './accountMeta.js';
import { buildBanRecords } from './banAnalytics.js';
import { ACCOUNT_SELECT_BAN } from './accountSelect.js';
import {
  RM_DEFAULTS,
  computeRmSupply,
  buildRmDiagnosis,
  formatRmNeedNote,
} from './rmSupplyModel.js';
import { loadRmSupplySettings, resolveRmInputs } from './rmSupplySettings.js';

const REC_PREFIX = '_ams_rec:';
const LOOKBACK_DAYS = 30;

function parseRecoveryMeta(notes) {
  return parsePrefixedJsonBlock(notes, REC_PREFIX);
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

function startOfDayUtcPlus8() {
  const offsetMs = 8 * 60 * 60 * 1000;
  const local = new Date(Date.now() + offsetMs);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMs).toISOString();
}

function siteKeyOfMeta(metadata) {
  return metadata?.site_key === 'pp' ? 'pp' : 'my';
}

async function loadRegistrationRates(siteKey) {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('entity_type', 'account')
    .contains('metadata', { registration_log: true });
  if (error) throw error;
  const dayStart = startOfDayUtcPlus8();
  let rows = (data || []).filter((r) => r.metadata);
  if (siteKey && siteKey !== 'all') {
    rows = rows.filter((r) => siteKeyOfMeta(r.metadata) === siteKey);
  }
  const total = rows.length;
  const failed = rows.filter((r) => r.metadata.result === 'fail').length;
  const registeredToday = rows.filter((r) => r.created_at >= dayStart).length;
  if (total === 0) return { Fr: RM_DEFAULTS.Fr / 100, total: 0, registeredToday: 0 };
  return { Fr: failed / total, total, registeredToday };
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

const RM_FLAGS_TTL_MS = 30_000;
let rmFlagsCache = null;
let rmFlagsCacheAt = 0;

export function invalidateRmSupplyFlagsCache() {
  rmFlagsCache = null;
  rmFlagsCacheAt = 0;
}

export async function loadRmSupplyModel(siteKey = 'all') {
  const sites = siteKey === 'all' ? ['my', 'pp'] : [siteKey];
  const accounts = await loadAccounts();
  const settings = await loadRmSupplySettings();

  const bySite = {};
  for (const sk of sites) {
    const counts = countByStatus(accounts, sk);
    const inUse = counts.IN_USE;
    const nurturing = counts.NURTURING;
    const registering = counts.REGISTERING;

    const banRecords = await loadBanRecords(sk);
    const { Fr, total: regAttempts, registeredToday } = await loadRegistrationRates(sk);
    const { R, Tr, completed: recCompleted, success: recSuccess } = await loadRecoveryRates(sk);

    const D = dailyBanRateOnPool(banRecords, inUse, 'IN_USE');
    const Wf = dailyBanRateOnPool(banRecords, Math.max(nurturing, 1), 'NURTURING');

    const liveRaw = {
      D,
      R,
      Wf,
      Fr,
      Tr,
    };

    const siteConfig = settings[sk] || settings.my;
    const resolved = resolveRmInputs(liveRaw, siteConfig);

    const inputs = {
      D: Math.round(resolved.D * 1000) / 10,
      R: Math.round(resolved.R * 1000) / 10,
      Wf: Math.round(resolved.Wf * 1000) / 10,
      Fr: Math.round(resolved.Fr * 1000) / 10,
      W: resolved.W,
      Tr: Math.round(resolved.Tr * 10) / 10,
      dev: resolved.dev,
      ppl: resolved.ppl,
      active: inUse,
      registering,
      nurturing,
      regAttempts,
      recCompleted,
      recSuccess,
      lookbackDays: LOOKBACK_DAYS,
      live: {
        D: Math.round(D * 1000) / 10,
        R: Math.round(R * 1000) / 10,
        Wf: Math.round(Wf * 1000) / 10,
        Fr: Math.round(Fr * 1000) / 10,
        Tr: Math.round(Tr * 10) / 10,
      },
      sources: resolved.sources,
    };

    const calc = computeRmSupply({
      active: inUse || 1,
      D: resolved.D,
      R: resolved.R,
      Wf: resolved.Wf,
      Fr: resolved.Fr,
      W: resolved.W,
      Tr: resolved.Tr,
      dev: resolved.dev,
      ppl: resolved.ppl,
    });

    const diagnosis = buildRmDiagnosis({
      D: resolved.D,
      R: resolved.R,
      Wf: resolved.Wf,
      Fr: resolved.Fr,
      yieldPct: calc.yield,
      warm: nurturing,
      toWarm: calc.toWarm,
      W: resolved.W,
      Tr: resolved.Tr,
      recCompleted,
    });

    bySite[sk] = {
      site_key: sk,
      inputs,
      config: siteConfig,
      ...calc,
      nurturingTarget: calc.warm,
      registeringTarget: calc.regDaily,
      diagnosis,
      needNote: formatRmNeedNote({ regDaily: calc.regDaily, yield: calc.yield, inputs }),
      registering,
      registeredToday,
    };
  }

  if (siteKey === 'all') {
    return { site_key: 'all', sites: bySite };
  }
  return { site_key: siteKey, ...bySite[siteKey] };
}

export async function loadRmSupplyFlagsBySite() {
  const now = Date.now();
  if (rmFlagsCache && now - rmFlagsCacheAt < RM_FLAGS_TTL_MS) {
    return rmFlagsCache;
  }
  const { sites } = await loadRmSupplyModel('all');
  rmFlagsCache = {
    my: sites.my,
    pp: sites.pp,
  };
  rmFlagsCacheAt = now;
  return rmFlagsCache;
}
