/** RM Operation Logic v3.2 — client mirror for live preview on Settings page. */

export const RM_DEFAULTS = {
  D: 20,
  R: 40,
  Wf: 20,
  Fr: 20,
  W: 7,
  Tr: 2,
  dev: 2,
  ppl: 50,
};

/** Phase 1 — fixed ban rates (manual) until live AMS metrics are trusted. */
export const RM_PHASE1_SOURCES = {
  D: 'manual',
  R: 'live',
  Wf: 'manual',
  Fr: 'live',
  Tr: 'live',
};

export const RM_LIVE_KEYS = ['D', 'R', 'Wf', 'Fr', 'Tr'];

export const RM_FIELDS = [
  {
    key: 'D',
    label: 'In-use ban rate',
    symbol: 'D',
    unit: '%',
    live: true,
    hint: 'Daily ban rate on IN_USE accounts (30-day lookback).',
  },
  {
    key: 'R',
    label: 'Recovery rate',
    symbol: 'R',
    unit: '%',
    live: true,
    hint: 'Share of completed recovery attempts that succeed.',
  },
  {
    key: 'Wf',
    label: 'Nurturing ban rate',
    symbol: 'Wf',
    unit: '%',
    live: true,
    hint: 'Daily ban rate during NURTURING phase.',
  },
  {
    key: 'Fr',
    label: 'Registration fail rate',
    symbol: 'Fr',
    unit: '%',
    live: true,
    hint: 'Failed registrations ÷ all registration attempts.',
  },
  {
    key: 'Tr',
    label: 'Recovery time',
    symbol: 'Tr',
    unit: 'days',
    live: true,
    hint: 'Average days from recovery need → success.',
  },
  {
    key: 'W',
    label: 'Nurturing window',
    symbol: 'W',
    unit: 'days',
    live: false,
    hint: 'Days accounts remain in nurturing before scan-in.',
  },
  {
    key: 'dev',
    label: 'Accounts per device',
    symbol: 'dev',
    unit: '',
    live: false,
    hint: 'Capacity planning — active accounts per device.',
  },
  {
    key: 'ppl',
    label: 'Accounts per staff',
    symbol: 'ppl',
    unit: '',
    live: false,
    hint: 'Capacity planning — total accounts per operator.',
  },
];

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
  RM_LIVE_KEYS.forEach((k) => {
    if (sources[k] !== 'manual') sources[k] = 'live';
  });
  return {
    sources,
    manual: { ...base.manual, ...(raw.manual || {}) },
  };
}

export function normalizeRmSupplySettings(raw) {
  const base = defaultRmSupplySettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    my: normalizeSiteConfig(raw.my),
    pp: normalizeSiteConfig(raw.pp),
  };
}

export function resolveRmInputs(live, siteConfig) {
  const cfg = normalizeSiteConfig(siteConfig);
  const pctKeys = new Set(['D', 'R', 'Wf', 'Fr']);

  const pick = (key) => {
    const liveVal = live?.[key];
    if (cfg.sources[key] === 'live' && liveVal != null && Number.isFinite(Number(liveVal))) {
      return pctKeys.has(key) ? Number(liveVal) / 100 : Number(liveVal);
    }
    const manual = cfg.manual[key] ?? RM_DEFAULTS[key];
    return pctKeys.has(key) ? manual / 100 : manual;
  };

  return {
    D: pick('D'),
    R: pick('R'),
    Wf: pick('Wf'),
    Fr: pick('Fr'),
    Tr: pick('Tr'),
    W: cfg.manual.W ?? RM_DEFAULTS.W,
    dev: cfg.manual.dev ?? RM_DEFAULTS.dev,
    ppl: cfg.manual.ppl ?? RM_DEFAULTS.ppl,
    sources: cfg.sources,
    manual: cfg.manual,
  };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

export function computeRmSupply({
  active,
  D,
  R,
  Wf,
  Fr,
  W,
  Tr,
  dev = RM_DEFAULTS.dev,
  ppl = RM_DEFAULTS.ppl,
}) {
  const actLoss = active * D * (1 - R);
  const need = actLoss;
  let yield_ = (1 - Fr) * (1 - Wf);
  if (yield_ <= 0) yield_ = 0.0001;
  const toWarm = need / (1 - Wf);
  const reg = need / yield_;
  const mult = 1 / yield_;
  const warm = toWarm * W;
  const rec = active * D * Tr;
  const total = active + warm + rec;
  return {
    active: Math.round(active),
    need: round1(need),
    yield: round1(yield_ * 100),
    regDaily: Math.ceil(reg),
    mult: round1(mult),
    warm: Math.round(warm),
    rec: round1(rec),
    total: Math.round(total),
    devices: Math.ceil(active / (dev || 1)),
    staff: Math.ceil(total / (ppl || 1)),
  };
}

export function previewSiteOutput(siteModel, siteConfig) {
  if (!siteModel?.inputs) return null;
  const live = siteModel.inputs.live || {};
  const resolved = resolveRmInputs(live, siteConfig);
  const active = siteModel.inputs.active || 1;
  return {
    ...computeRmSupply({
      active,
      D: resolved.D,
      R: resolved.R,
      Wf: resolved.Wf,
      Fr: resolved.Fr,
      W: resolved.W,
      Tr: resolved.Tr,
      dev: resolved.dev,
      ppl: resolved.ppl,
    }),
    registering: siteModel.registering ?? siteModel.inputs.registering ?? 0,
    effective: {
      D: round1(resolved.D * 100),
      R: round1(resolved.R * 100),
      Wf: round1(resolved.Wf * 100),
      Fr: round1(resolved.Fr * 100),
      Tr: round1(resolved.Tr),
      W: resolved.W,
    },
  };
}

export function effectiveValue(fieldKey, siteModel, siteConfig) {
  const cfg = normalizeSiteConfig(siteConfig);
  const live = siteModel?.inputs?.live?.[fieldKey];
  if (RM_LIVE_KEYS.includes(fieldKey) && cfg.sources[fieldKey] === 'live') {
    return live ?? RM_DEFAULTS[fieldKey];
  }
  return cfg.manual[fieldKey] ?? RM_DEFAULTS[fieldKey];
}
