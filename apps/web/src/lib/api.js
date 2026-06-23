import axios from 'axios';
import { getSupabase } from './supabase';

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
    const onLogin = typeof window !== 'undefined' && window.location.pathname.startsWith('/login');
    if (status === 401 && !authRedirecting && !onLogin) {
      authRedirecting = true;
      try {
        await getSupabase().auth.signOut();
      } catch {
        /* ignore */
      }
      window.location.href = '/login';
      return new Promise(() => {});
    }
    const message = err.response?.data?.error || err.message;
    return Promise.reject(new Error(message));
  },
);

export default api;
