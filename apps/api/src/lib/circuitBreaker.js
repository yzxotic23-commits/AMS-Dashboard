import { supabaseAdmin } from './supabase.js';
import { writeAudit } from './audit.js';

export const BREAKER_WINDOW_MINUTES = 10;

const DEFAULT_LIMITS = {
  account_ban: 20,
  account_disconnect: 30,
  delete: 20,
};

const LABELS = {
  account_ban: 'account bans',
  account_disconnect: 'engine disconnects',
  delete: 'deletions',
};

/** BREAKER_LIMITS="account_ban:20,delete:20" overrides the defaults per kind. */
function limitFor(kind) {
  const override = (process.env.BREAKER_LIMITS || '')
    .split(',')
    .map((pair) => pair.split(':').map((s) => s.trim()))
    .find(([k]) => k === kind);
  const n = Number(override?.[1]);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMITS[kind];
}

/**
 * Guards irreversible actions against runaway batches (automation bugs, mass clicks).
 * Counts are global per kind across all users and API instances, read from
 * breaker_events. Past the limit the request is refused with 429 BULK_LIMIT until a
 * human resends it with `X-AMS-Bulk-Confirm: <kind>`.
 */
export function circuitBreaker(kind) {
  return async (req, res, next) => {
    try {
      const limit = limitFor(kind);
      const confirmed = req.get('x-ams-bulk-confirm') === kind;
      const automated = req.get('x-ams-automation') === '1';
      const since = new Date(Date.now() - BREAKER_WINDOW_MINUTES * 60_000).toISOString();

      const { count, error } = await supabaseAdmin
        .from('breaker_events')
        .select('id', { count: 'exact', head: true })
        .eq('kind', kind)
        .eq('blocked', false)
        .gte('created_at', since);
      if (error) throw error;

      const row = {
        kind,
        user_id: req.profile?.id || null,
        automated,
        confirmed,
        path: `${req.method} ${req.originalUrl}`.slice(0, 200),
      };

      if ((count || 0) >= limit && !confirmed) {
        const { count: blockedBefore } = await supabaseAdmin
          .from('breaker_events')
          .select('id', { count: 'exact', head: true })
          .eq('kind', kind)
          .eq('blocked', true)
          .gte('created_at', since);
        await supabaseAdmin.from('breaker_events').insert({ ...row, blocked: true });
        if (!blockedBefore) {
          await writeAudit({
            entityType: 'session',
            entityId: null,
            action: 'STATE_CHANGE',
            metadata: {
              kind: 'circuit_breaker',
              breaker: kind,
              label: LABELS[kind],
              limit,
              window_minutes: BREAKER_WINDOW_MINUTES,
              automated,
              path: row.path,
            },
            userId: req.profile?.id,
            req,
          });
        }
        return res.status(429).json({
          error: `Paused: more than ${limit} ${LABELS[kind]} in ${BREAKER_WINDOW_MINUTES} minutes. Confirm to continue.`,
          code: 'BULK_LIMIT',
          kind,
          label: LABELS[kind],
          limit,
          window_minutes: BREAKER_WINDOW_MINUTES,
        });
      }

      await supabaseAdmin.from('breaker_events').insert(row);
      next();
    } catch (e) {
      // A broken counter must not block normal operations.
      console.error('[circuit-breaker] check failed:', e.message);
      next();
    }
  };
}
