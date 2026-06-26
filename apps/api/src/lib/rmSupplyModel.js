/**
 * RM Operation Logic v3.2 — mirrors RM_Operation_Logic.html calc()
 */

export const RM_DEFAULTS = {
  D: 5,
  R: 40,
  Wf: 15,
  Fr: 20,
  W: 7,
  Tr: 2,
  dev: 2,
  ppl: 50,
};

export function round1(x) {
  return Math.round(x * 10) / 10;
}

/** Core supply calculation (inputs as decimals for D, R, Wf, Fr). */
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
  const devices = Math.ceil(active / (dev || 1));
  const staff = Math.ceil(total / (ppl || 1));

  return {
    active: Math.round(active),
    actLoss: round1(actLoss),
    need: round1(need),
    yield: round1(yield_ * 100),
    toWarm: round1(toWarm),
    reg: round1(reg),
    regDaily: Math.ceil(reg),
    mult: round1(mult),
    warm: Math.round(warm),
    rec: round1(rec),
    total: Math.round(total),
    devices,
    staff,
  };
}

export function buildRmDiagnosis({ D, R, Wf, Fr, yieldPct, warm, toWarm, W, Tr }) {
  const flags = {
    lossHigh: D * 100 >= 8,
    prodLow: toWarm > 0 && warm < toWarm * W * 0.999,
    recoverBad: R * 100 < 40 || Tr > 3,
    yieldLow: yieldPct < 70,
  };

  const rows = [];
  if (flags.lossHigh) {
    rows.push({
      id: 'lossHigh',
      symptom: 'Front line short, nurturing pool OK',
      cause: 'Ban rate rising',
      action: 'Bring ban rate down before adding registration volume.',
    });
  }
  if (flags.prodLow) {
    rows.push({
      id: 'prodLow',
      symptom: 'Front line short, nurturing pool also low',
      cause: 'Registration capacity short',
      action: 'Add registration volume — this is when RM should register more.',
    });
  }
  if (flags.recoverBad) {
    rows.push({
      id: 'recoverBad',
      symptom: 'Recovery backlog or slow recovery',
      cause: 'Low recovery rate or long recovery time',
      action: 'Improve recovery — each +10% recovery lowers registration need.',
    });
  }
  if (flags.yieldLow) {
    rows.push({
      id: 'yieldLow',
      symptom: 'High registration input, few usable accounts',
      cause: 'Registration failure or nurturing ban rate too high',
      action: 'Fix registration quality and nurturing environment before adding volume.',
    });
  }

  return { flags, rows };
}

export function formatRmNeedNote({ regDaily, yield: yieldPct, inputs }) {
  const d = inputs?.D ?? RM_DEFAULTS.D;
  return `RM supply: register ${regDaily}/day (in-use ban ${d}%, yield ${yieldPct}%)`;
}

/** Rank prepared numbers — top N get Needs Registration (FIFO). */
export function rankPreparedNeedFlags(rows, { regDaily, registering }) {
  const slots = Math.max(0, regDaily - (registering || 0));
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return ta - tb;
  });
  const needIds = new Set(sorted.slice(0, slots).map((r) => r.id));
  return { slots, needIds };
}
