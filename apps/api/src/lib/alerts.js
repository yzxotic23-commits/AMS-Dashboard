const ALERT_TIMEOUT_MS = 2500;
const ALERT_USER_KINDS = new Set(['user_lock', 'user_unlock', 'role_change', 'permission_change']);
const ALLOWLIST_FIELDS = ['department', 'user', 'remark'];
const MAX_TABLE_ROWS = 20;

/** Posts to the Slack incoming webhook in ALERT_SLACK_WEBHOOK_URL; no-op when unset. */
export async function sendSlackAlert(payload) {
  const url = process.env.ALERT_SLACK_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof payload === 'string' ? { text: payload } : payload),
      signal: controller.signal,
    });
    if (!res.ok) console.error('[alert] Slack webhook HTTP', res.status);
  } catch (e) {
    console.error('[alert] Slack webhook failed:', e.message);
  } finally {
    clearTimeout(timer);
  }
}

/** Slack mrkdwn treats &, < and > as control characters. */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatTime(date = new Date()) {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${text} GMT +7`;
}

const bold = (text) => ({
  type: 'rich_text',
  elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text, style: { bold: true } }] }],
});
const code = (text) => ({
  type: 'rich_text',
  elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text, style: { code: true } }] }],
});
const raw = (text) => ({ type: 'raw_text', text: text || '—' });

function allowlistAlert(prev = {}, next = {}) {
  const toggled = Boolean(prev.enabled) !== Boolean(next.enabled);
  const activeCount = (next.entries || []).filter((e) => e.active !== false).length;

  const rows = [];
  const before = new Map((prev.entries || []).map((e) => [e.value, e]));
  const after = new Map((next.entries || []).map((e) => [e.value, e]));
  for (const [value, e] of after) {
    const old = before.get(value);
    if (!old) {
      rows.push(['Added', e]);
      continue;
    }
    if ((old.active !== false) !== (e.active !== false)) {
      rows.push([e.active === false ? 'Set Non Active' : 'Set Active', e]);
    }
    const edited = ALLOWLIST_FIELDS.filter((f) => (old[f] || '') !== (e[f] || ''));
    if (edited.length) rows.push([`Edited ${edited.join(', ')}`, e]);
  }
  for (const [value, e] of before) {
    if (!after.has(value)) rows.push(['Removed', e]);
  }

  let alert;
  if (toggled && next.enabled) {
    alert = {
      title: '🛡️ Network allowlist turned ON',
      intro: 'Only *active IPs* in the list can open AMS.',
      details: [['Active IPs in list', activeCount]],
    };
  } else if (toggled) {
    alert = {
      title: '🔓 Network allowlist turned OFF',
      intro: 'AMS is now reachable from *any network*.',
      details: [['Active IPs in list', activeCount]],
    };
  } else {
    alert = {
      title: '🛡️ Network allowlist updated',
      intro: rows.length ? null : 'Saved with no changes.',
      details: [],
    };
  }

  if (rows.length) {
    const shown = rows.slice(0, MAX_TABLE_ROWS);
    alert.table = {
      type: 'table',
      column_settings: [{ is_wrapped: true }, {}, {}, { is_wrapped: true }],
      rows: [
        [bold('Change'), bold('IP address'), bold('Department'), bold('User')],
        ...shown.map(([change, e]) => [raw(change), code(e.value), raw(e.department), raw(e.user)]),
      ],
    };
    if (rows.length > shown.length) alert.intro = `Showing ${shown.length} of ${rows.length} changes.`;
  }
  return alert;
}

function buildAlert({ action, entityType, metadata, previousValue, newValue }) {
  const m = metadata || {};
  switch (action) {
    case 'EXPORT': {
      if (m.export === 'telegram_groups') {
        return {
          title: '📤 Data exported',
          details: [
            ['Export', 'Telegram'],
            ...(m.brand ? [['Brand', m.brand]] : []),
            ...(m.account_label || m.account
              ? [['Account', m.account_label || m.account]]
              : []),
            ...(m.rows != null ? [['Rows', m.rows]] : []),
          ],
        };
      }
      return {
        title: '📤 Data exported',
        details: [['Export', m.export || entityType], ...(m.rows != null ? [['Rows', m.rows]] : [])],
      };
    }
    case 'DELETE':
    case 'USER_DELETE': {
      const v = previousValue || {};
      const name = v.username || v.account_name || v.phone_number || v.device_name || v.ip_address;
      return {
        title: action === 'USER_DELETE' ? '🗑️ User deleted' : '🗑️ Record deleted',
        details: [['Type', entityType], ...(name ? [['Name', name]] : [])],
      };
    }
    case 'USER_UPDATE': {
      const who = newValue?.username || previousValue?.username || '—';
      if (m.kind === 'role_change') {
        return {
          title: '👤 Role changed',
          details: [['User', who], ['Role', `${previousValue?.role} → ${newValue?.role}`]],
        };
      }
      if (m.kind === 'permission_change') {
        return {
          title: newValue?.can_offboard ? '🔑 Offboarding permission granted' : '🔑 Offboarding permission removed',
          details: [['User', who]],
        };
      }
      const locked = m.kind === 'user_lock';
      return {
        title: locked ? '🔒 User locked' : '🔓 User unlocked',
        details: [['User', who], ...(m.reason ? [['Reason', m.reason]] : [])],
      };
    }
    case 'SETTINGS_UPDATE':
      if (m.setting === 'ip_allowlist') return allowlistAlert(previousValue, newValue);
      return { title: '⚙️ Settings changed', details: [['Setting', m.setting || entityType]] };
    case 'BULK_IMPORT':
      return {
        title: '📥 Bulk import',
        details: [['Type', entityType], ...(newValue?.imported != null ? [['Rows', newValue.imported]] : [])],
      };
    case 'STATE_CHANGE':
      if (m.kind !== 'circuit_breaker') return null;
      return {
        title: '⛔ Circuit breaker tripped',
        details: [
          ['Action', m.label],
          ['Limit', `more than ${m.limit} in ${m.window_minutes} min`],
          ['Result', m.automated ? 'Automation paused' : 'Waiting for manual confirmation'],
        ],
      };
    default:
      return null;
  }
}

function renderAlert(alert, { actor, ip, at }) {
  const details = [
    ...alert.details,
    ['By', actor || 'system'],
    ...(ip ? [['From IP', ip]] : []),
    ['Time', formatTime(at)],
  ];
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: alert.title, emoji: true } }];
  if (alert.intro) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: alert.intro } });
  if (alert.table) blocks.push(alert.table, { type: 'divider' });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: details.map(([k, v]) => `•  *${esc(k)}:*  ${esc(v)}`).join('\n') },
  });
  const plainTitle = alert.title.replace(/^\P{L}+/u, '');
  return {
    text: `AMS: ${plainTitle} by ${actor || 'system'}`,
    blocks,
  };
}

export function shouldAlert({ action, metadata }) {
  if (['EXPORT', 'DELETE', 'USER_DELETE', 'SETTINGS_UPDATE', 'BULK_IMPORT'].includes(action)) return true;
  if (action === 'USER_UPDATE') return ALERT_USER_KINDS.has(metadata?.kind);
  if (action === 'STATE_CHANGE') return metadata?.kind === 'circuit_breaker';
  return false;
}

export function buildAlertPayload(entry, ctx) {
  if (!shouldAlert(entry)) return null;
  const alert = buildAlert(entry);
  return alert ? renderAlert(alert, ctx) : null;
}

export async function alertForAudit(entry, { actor, ip }) {
  if (!process.env.ALERT_SLACK_WEBHOOK_URL) return;
  const payload = buildAlertPayload(entry, { actor, ip, at: new Date() });
  if (payload) await sendSlackAlert(payload);
}
