/** SIM Card Anomaly — reasons, platforms, recording, and carrier analytics. */

import { supabaseAdmin } from './supabase.js';
import { inferSimSiteKey } from './simMeta.js';

export const SIM_ANOMALY_REASONS = [
  { id: 'service_suspended', label: 'Service suspended / fraud' },
  { id: 'expired', label: 'Expired' },
  { id: 'otp_failed', label: 'Cannot receive OTP' },
];

export const SIM_ANOMALY_PLATFORMS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram', label: 'Telegram' },
];

export const SIM_ANOMALY_REASON_IDS = SIM_ANOMALY_REASONS.map((r) => r.id);
export const SIM_ANOMALY_PLATFORM_IDS = SIM_ANOMALY_PLATFORMS.map((p) => p.id);

/** SIM Ledger exception id used when a card is flagged as a SIM Card Anomaly. */
export const SIM_ANOMALY_EXCEPTION = 'sim_anomaly';

export function simAnomalyReasonLabel(reason) {
  return SIM_ANOMALY_REASONS.find((r) => r.id === reason)?.label || reason || '—';
}

export function simAnomalyPlatformLabel(platform) {
  return SIM_ANOMALY_PLATFORMS.find((p) => p.id === platform)?.label || platform || '—';
}

function normalizeCarrier(carrier) {
  const text = String(carrier || '').trim();
  return text || 'Unknown';
}

function simSiteKey(sim) {
  if (!sim) return null;
  if (sim.site_key === 'my' || sim.site_key === 'pp') return sim.site_key;
  return inferSimSiteKey(sim);
}

/** Resolve the SIM row behind an account: hard link first, then phone digits. */
export async function findSimForAccount(account) {
  if (account?.sim_id) {
    const { data, error } = await supabaseAdmin.from('sims').select('*').eq('id', account.sim_id).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const digits = String(account?.phone_number || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const { data, error } = await supabaseAdmin
    .from('sims')
    .select('*')
    .ilike('phone_number', `%${digits.slice(-9)}`)
    .limit(2);
  if (error) throw error;
  return data?.length === 1 ? data[0] : null;
}

/**
 * Append one anomaly row (carrier/phone/site are snapshots) and flag the SIM in the ledger
 * as Pending Review so Admin stops topping it up until R&M reviews it.
 */
export async function recordSimAnomaly({
  sim,
  account = null,
  platform = 'whatsapp',
  reason,
  detail = null,
  source,
  profile,
  fallbackCarrier = null,
  fallbackSiteKey = null,
}) {
  const now = new Date().toISOString();
  const actorName = profile?.full_name || profile?.username || null;
  const row = {
    sim_id: sim?.id || null,
    account_id: account?.id || null,
    carrier: normalizeCarrier(sim?.carrier || fallbackCarrier),
    phone_number: sim?.phone_number || account?.phone_number || null,
    site_key: simSiteKey(sim) || fallbackSiteKey || null,
    platform,
    reason,
    detail: detail ? String(detail).trim() : null,
    source,
    created_by: profile?.id || null,
    created_by_name: actorName,
    occurred_at: now,
  };
  const { data: inserted, error } = await supabaseAdmin.from('sim_anomalies').insert(row).select('*').single();
  if (error) throw error;

  let simAfter = sim || null;
  if (sim?.id) {
    const exception = {
      id: `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      reason: SIM_ANOMALY_EXCEPTION,
      sim_reason: reason,
      platform,
      detail: row.detail,
      anomaly_id: inserted.id,
      created_at: now,
      created_by: actorName,
    };
    const { data: updated, error: simErr } = await supabaseAdmin
      .from('sims')
      .update({ last_exception: exception, ledger_status: 'pending_review' })
      .eq('id', sim.id)
      .select('*')
      .maybeSingle();
    if (simErr) throw simErr;
    simAfter = updated || sim;
  }

  return { anomaly: inserted, sim: simAfter };
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/**
 * Carrier rate = distinct SIMs with ≥1 anomaly in range ÷ SIMs of that carrier on the ledger.
 * Telegram-only cards may not be in the ledger, so the denominator never drops below the
 * number of affected cards.
 */
export function aggregateSimAnomalyStats(anomalies = [], sims = []) {
  const reasonCounts = Object.fromEntries(SIM_ANOMALY_REASON_IDS.map((id) => [id, 0]));
  const platformCounts = Object.fromEntries(SIM_ANOMALY_PLATFORM_IDS.map((id) => [id, 0]));
  const byCarrier = new Map();

  const carrierBucket = (carrier) => {
    if (!byCarrier.has(carrier)) {
      byCarrier.set(carrier, {
        carrier,
        anomalies: 0,
        simIds: new Set(),
        reasons: Object.fromEntries(SIM_ANOMALY_REASON_IDS.map((id) => [id, 0])),
        totalSims: 0,
      });
    }
    return byCarrier.get(carrier);
  };

  for (const sim of sims) carrierBucket(normalizeCarrier(sim.carrier)).totalSims += 1;

  for (const a of anomalies) {
    if (a.reason in reasonCounts) reasonCounts[a.reason] += 1;
    if (a.platform in platformCounts) platformCounts[a.platform] += 1;
    const bucket = carrierBucket(normalizeCarrier(a.carrier));
    bucket.anomalies += 1;
    if (a.reason in bucket.reasons) bucket.reasons[a.reason] += 1;
    bucket.simIds.add(a.sim_id || a.phone_number || a.id);
  }

  const total = anomalies.length;
  const carriers = [...byCarrier.values()]
    .map((b) => {
      const affectedSims = b.simIds.size;
      const denom = Math.max(b.totalSims, affectedSims);
      return {
        carrier: b.carrier,
        anomalies: b.anomalies,
        affectedSims,
        totalSims: denom,
        rate: pct(affectedSims, denom),
        reasons: b.reasons,
      };
    })
    .filter((c) => c.totalSims > 0)
    .sort((x, y) => y.rate - x.rate || y.anomalies - x.anomalies || x.carrier.localeCompare(y.carrier));

  return {
    total,
    affectedSims: new Set(anomalies.map((a) => a.sim_id || a.phone_number || a.id)).size,
    totalSims: sims.length,
    byReason: SIM_ANOMALY_REASONS.map((r) => ({
      id: r.id,
      label: r.label,
      count: reasonCounts[r.id],
      pct: pct(reasonCounts[r.id], total),
    })),
    byPlatform: SIM_ANOMALY_PLATFORMS.map((p) => ({
      id: p.id,
      label: p.label,
      count: platformCounts[p.id],
      pct: pct(platformCounts[p.id], total),
    })),
    byCarrier: carriers,
  };
}

export function simSiteKeyForStats(sim) {
  return simSiteKey(sim);
}
