const ALERT_TIMEOUT_MS = 2500;

/** Posts to the Slack incoming webhook in ALERT_SLACK_WEBHOOK_URL; no-op when unset. */
export async function sendSlackAlert(text) {
  const url = process.env.ALERT_SLACK_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) console.error('[alert] Slack webhook HTTP', res.status);
  } catch (e) {
    console.error('[alert] Slack webhook failed:', e.message);
  } finally {
    clearTimeout(timer);
  }
}

const ALERT_USER_KINDS = new Set(['user_lock', 'user_unlock', 'role_change']);

function describe({ action, entityType, metadata, previousValue, newValue }) {
  const m = metadata || {};
  switch (action) {
    case 'EXPORT':
      return `Export · ${m.export || entityType}${m.rows != null ? ` (${m.rows} rows)` : ''}`;
    case 'DELETE':
    case 'USER_DELETE': {
      const v = previousValue || {};
      const name = v.username || v.account_name || v.phone_number || v.device_name || v.ip_address || '';
      return `Deleted ${entityType}${name ? ` · ${name}` : ''}`;
    }
    case 'USER_UPDATE': {
      const who = newValue?.username || previousValue?.username || '';
      if (m.kind === 'role_change') return `Role change · ${who}: ${previousValue?.role} → ${newValue?.role}`;
      return `${m.kind === 'user_lock' ? 'Locked' : 'Unlocked'} user · ${who}`;
    }
    case 'SETTINGS_UPDATE':
      return `Settings changed · ${m.setting || entityType}`;
    case 'BULK_IMPORT':
      return `Bulk import · ${entityType}${newValue?.imported != null ? ` (${newValue.imported} rows)` : ''}`;
    case 'STATE_CHANGE':
      if (m.kind === 'circuit_breaker') {
        return `Circuit breaker tripped · ${m.label}: more than ${m.limit} in ${m.window_minutes} min — ${m.automated ? 'automation paused' : 'waiting for manual confirmation'}`;
      }
      return null;
    default:
      return null;
  }
}

export function shouldAlert({ action, metadata }) {
  if (['EXPORT', 'DELETE', 'USER_DELETE', 'SETTINGS_UPDATE', 'BULK_IMPORT'].includes(action)) return true;
  if (action === 'USER_UPDATE') return ALERT_USER_KINDS.has(metadata?.kind);
  if (action === 'STATE_CHANGE') return metadata?.kind === 'circuit_breaker';
  return false;
}

export async function alertForAudit(entry, { actor, ip }) {
  if (!process.env.ALERT_SLACK_WEBHOOK_URL || !shouldAlert(entry)) return;
  const summary = describe(entry);
  if (!summary) return;
  await sendSlackAlert(`:rotating_light: *AMS* — ${summary}\nby ${actor || 'system'}${ip ? ` · ${ip}` : ''}`);
}
