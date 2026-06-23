import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getWebConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  if (!url || !anonKey) {
    return {
      ok: false,
      message: 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing in AMS Project/.env',
    };
  }
  if (url.includes('your-project') || anonKey.includes('your-anon')) {
    return {
      ok: false,
      message: 'Add real Supabase credentials to AMS Project/.env, then restart npm run dev.',
    };
  }
  return { ok: true, url, anonKey, apiUrl };
}

export function getSupabase() {
  const cfg = getWebConfig();
  if (!cfg.ok) throw new Error(cfg.message);
  if (!_client) {
    _client = createClient(cfg.url, cfg.anonKey);
  }
  return _client;
}
