import { createClient } from '@supabase/supabase-js';

let _admin = null;

const RETRY_DELAYS_MS = [300, 1000];

/**
 * Retries requests that died on the network (undici "fetch failed": reset or reused socket),
 * but only when repeating them cannot create duplicates: reads, and storage uploads
 * (fixed path + upsert). Inserts and updates are never retried here.
 */
function isRetrySafe(url, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  return String(url).includes('/storage/v1/object/') && new Headers(init.headers).get('x-upsert') === 'true';
}

async function fetchWithRetry(url, init) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (!(e instanceof TypeError) || attempt >= RETRY_DELAYS_MS.length || !isRetrySafe(url, init)) throw e;
      console.warn(`[supabase] network error, retry ${attempt + 1}: ${e.cause?.code || e.cause?.message || e.message}`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

function requireEnv() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/api/.env');
  }
  return { url, serviceKey };
}

export function getSupabaseAdmin() {
  if (!_admin) {
    const { url, serviceKey } = requireEnv();
    _admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWithRetry },
    });
  }
  return _admin;
}

/** @deprecated use getSupabaseAdmin() — lazy proxy for existing imports */
export const supabaseAdmin = new Proxy({}, {
  get(_target, prop) {
    return getSupabaseAdmin()[prop];
  },
});

export function supabaseAsUser(accessToken) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in apps/api/.env');
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
