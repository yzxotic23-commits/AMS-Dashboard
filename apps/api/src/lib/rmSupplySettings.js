import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabaseAdmin } from './supabase.js';
import { RM_DEFAULTS, RM_PHASE1_SOURCES } from './rmSupplyModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_FILE = path.join(__dirname, '../../data/rm-supply-settings.json');

export const RM_SUPPLY_SETTINGS_KEY = 'rm_supply';

const LIVE_KEYS = ['D', 'R', 'Wf', 'Fr', 'Tr'];

let tableProbe = null;

function isMissingTableError(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || msg.includes('app_settings')
    || msg.includes('does not exist');
}

async function probeSettingsTable() {
  if (tableProbe != null) return tableProbe;
  const { error } = await supabaseAdmin
    .from('app_settings')
    .select('key')
    .limit(1);
  tableProbe = !isMissingTableError(error);
  return tableProbe;
}

async function loadFileFallback() {
  try {
    const raw = await fs.readFile(FALLBACK_FILE, 'utf8');
    return normalizeRmSupplySettings(JSON.parse(raw));
  } catch {
    return defaultRmSupplySettings();
  }
}

async function saveFileFallback(value) {
  await fs.mkdir(path.dirname(FALLBACK_FILE), { recursive: true });
  await fs.writeFile(FALLBACK_FILE, JSON.stringify(value, null, 2), 'utf8');
}

export function defaultSiteRmConfig() {
  return {
    sources: { ...RM_PHASE1_SOURCES },
    manual: { ...RM_DEFAULTS },
  };
}

export function defaultRmSupplySettings() {
  return {
    my: defaultSiteRmConfig(),
    pp: defaultSiteRmConfig(),
  };
}

function normalizeSiteConfig(raw) {
  const base = defaultSiteRmConfig();
  if (!raw || typeof raw !== 'object') return base;
  const sources = { ...base.sources, ...(raw.sources || {}) };
  LIVE_KEYS.forEach((k) => {
    if (sources[k] !== 'manual') sources[k] = 'live';
  });
  const manual = { ...base.manual, ...(raw.manual || {}) };
  return { sources, manual };
}

export function normalizeRmSupplySettings(raw) {
  const base = defaultRmSupplySettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    my: normalizeSiteConfig(raw.my),
    pp: normalizeSiteConfig(raw.pp),
  };
}

export async function loadRmSupplySettings() {
  const hasTable = await probeSettingsTable();
  if (!hasTable) return loadFileFallback();

  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', RM_SUPPLY_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return loadFileFallback();
    throw error;
  }
  return normalizeRmSupplySettings(data?.value);
}

export async function saveRmSupplySettings(value, userId) {
  const normalized = normalizeRmSupplySettings(value);
  const hasTable = await probeSettingsTable();

  if (!hasTable) {
    await saveFileFallback(normalized);
    return normalized;
  }

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({
      key: RM_SUPPLY_SETTINGS_KEY,
      value: normalized,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    });
  if (error) {
    if (isMissingTableError(error)) {
      await saveFileFallback(normalized);
      return normalized;
    }
    throw error;
  }
  return normalized;
}

/** Pick effective decimal inputs for computeRmSupply. */
export function resolveRmInputs(live, siteConfig) {
  const cfg = normalizeSiteConfig(siteConfig);
  const pick = (key, liveVal) => {
    if (cfg.sources[key] === 'live' && liveVal != null && Number.isFinite(liveVal)) {
      return liveVal;
    }
    const manual = cfg.manual[key] ?? RM_DEFAULTS[key];
    if (key === 'Tr' || key === 'W' || key === 'dev' || key === 'ppl') return manual;
    return manual / 100;
  };

  return {
    D: pick('D', live.D),
    R: pick('R', live.R),
    Wf: pick('Wf', live.Wf),
    Fr: pick('Fr', live.Fr),
    Tr: pick('Tr', live.Tr),
    W: cfg.manual.W ?? RM_DEFAULTS.W,
    dev: cfg.manual.dev ?? RM_DEFAULTS.dev,
    ppl: cfg.manual.ppl ?? RM_DEFAULTS.ppl,
    sourceLabels: {
      D: cfg.sources.D === 'live' ? 'live' : 'manual',
      R: cfg.sources.R === 'live' ? 'live' : 'manual',
      Wf: cfg.sources.Wf === 'live' ? 'live' : 'manual',
      Fr: cfg.sources.Fr === 'live' ? 'live' : 'manual',
      Tr: cfg.sources.Tr === 'live' ? 'live' : 'manual',
    },
    manual: cfg.manual,
    sources: cfg.sources,
  };
}
