import axios from 'axios';
import { getSupabase } from './supabase';
import { formatApiError } from './format-api-error';

function resolveApiOrigin() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://localhost:4000';
  return ''; // Vercel: same-origin /api/v1
}

const api = axios.create({
  baseURL: `${resolveApiOrigin()}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
});

let authRedirecting = false;

export const IP_BLOCKED_EVENT = 'ams:ip-blocked';
export const BREAKER_CONFIRM_EVENT = 'ams:breaker-confirm';
export const BREAKER_PAUSED_EVENT = 'ams:breaker-paused';

/** Header marking background automation calls (they pause instead of prompting). */
export const AUTOMATION_HEADERS = { 'X-AMS-Automation': '1' };

const breakerConfirmedUntil = new Map();
const pendingBreakerConfirm = new Map();

function breakerKindFor(config) {
  const method = String(config.method || 'get').toLowerCase();
  const url = String(config.url || '');
  if (method === 'delete') return 'delete';
  if (method === 'post' && /\/accounts\/[^/]+\/ban$/.test(url)) return 'account_ban';
  if (method === 'post' && /\/accounts\/[^/]+\/engine-disconnect$/.test(url)) return 'account_disconnect';
  return null;
}

/** After a human confirms, let the rest of the batch through for the breaker window. */
export function confirmBreaker(kind, minutes) {
  breakerConfirmedUntil.set(kind, Date.now() + minutes * 60_000);
}

function headerValue(headers, name) {
  return headers?.get?.(name) ?? headers?.[name];
}

const breakerDeclinedUntil = new Map();
const DECLINE_QUIET_MS = 60_000;

function askBreakerConfirm(detail) {
  if ((breakerDeclinedUntil.get(detail.kind) || 0) > Date.now()) return Promise.resolve(false);
  let pending = pendingBreakerConfirm.get(detail.kind);
  if (!pending) {
    pending = new Promise((resolve) => {
      window.dispatchEvent(new CustomEvent(BREAKER_CONFIRM_EVENT, { detail: { ...detail, resolve } }));
    });
    pendingBreakerConfirm.set(detail.kind, pending);
    pending.then((ok) => {
      pendingBreakerConfirm.delete(detail.kind);
      // Stop the rest of the batch instead of re-asking for every remaining item.
      if (!ok) breakerDeclinedUntil.set(detail.kind, Date.now() + DECLINE_QUIET_MS);
    });
  }
  return pending;
}

api.interceptors.request.use(async (config) => {
  try {
    const { data: { session } } = await getSupabase().auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    /* not signed in yet */
  }
  const kind = breakerKindFor(config);
  if (kind && (breakerConfirmedUntil.get(kind) || 0) > Date.now()) {
    config.headers['X-AMS-Bulk-Confirm'] = kind;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err.response?.status;
    const code = err.response?.data?.code;
    const onLogin = typeof window !== 'undefined' && window.location.pathname.startsWith('/login');
    const deactivated = status === 403 && code === 'ACCOUNT_DEACTIVATED';
    if ((status === 401 || deactivated) && !authRedirecting && !onLogin) {
      authRedirecting = true;
      try {
        await getSupabase().auth.signOut();
      } catch {
        /* ignore */
      }
      window.location.href = deactivated ? '/login?reason=deactivated' : '/login';
      return new Promise(() => {});
    }
    if (status === 403 && code === 'IP_NOT_ALLOWED' && !onLogin) {
      window.dispatchEvent(new CustomEvent(IP_BLOCKED_EVENT, { detail: { ip: err.response.data.ip } }));
    }
    if (status === 429 && code === 'BULK_LIMIT') {
      const detail = err.response.data;
      const cfg = err.config;
      if (headerValue(cfg?.headers, 'X-AMS-Automation') === '1') {
        window.dispatchEvent(new CustomEvent(BREAKER_PAUSED_EVENT, { detail }));
      } else if (cfg && !cfg._breakerRetried) {
        const confirmed = await askBreakerConfirm(detail);
        if (confirmed) {
          confirmBreaker(detail.kind, detail.window_minutes);
          cfg._breakerRetried = true;
          cfg.headers['X-AMS-Bulk-Confirm'] = detail.kind;
          return api.request(cfg);
        }
      }
    }
    const message = formatApiError(err, err.message || 'Request failed');
    return Promise.reject(new Error(message));
  },
);

export default api;
