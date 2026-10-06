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

api.interceptors.request.use(async (config) => {
  try {
    const { data: { session } } = await getSupabase().auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    /* not signed in yet */
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
    const message = formatApiError(err, err.message || 'Request failed');
    return Promise.reject(new Error(message));
  },
);

export default api;
