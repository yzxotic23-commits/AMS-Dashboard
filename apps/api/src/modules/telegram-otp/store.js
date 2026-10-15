import { supabaseAdmin } from '../../lib/supabase.js';

/** Same window the Telegram bot gives a /login request. */
export const OTP_REQUEST_TTL_MS = 5 * 60 * 1000;
/** How long a delivered code and password stay readable before they are wiped. */
export const OTP_VIEW_WINDOW_MS = 3 * 60 * 1000;

/** Expire stale requests and wipe codes/passwords past their view window. */
export async function purgeOtpRequests() {
  const now = new Date().toISOString();
  const [stale, wiped] = await Promise.all([
    supabaseAdmin
      .from('otp_requests')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', now),
    supabaseAdmin
      .from('otp_requests')
      .update({ code: null, password: null })
      .eq('status', 'delivered')
      .lt('expires_at', now)
      .not('code', 'is', null),
  ]);
  if (stale.error) throw stale.error;
  if (wiped.error) throw wiped.error;
}

export function sameOwner(a, b) {
  return Boolean(a && b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Only Ready accounts have a live bot session; others (Pending, Disconnected, Expired, …) never receive the code. */
export function isSessionReady(account) {
  return String(account?.status || '').trim().toLowerCase() === 'ready';
}

/** Admins: any account. Operators and Business: GCS accounts of their assigned brands, shooter accounts of their own owner. */
export function isAssignedAccount(profile, account) {
  if (!profile || !account?.enabled) return false;
  if (profile.role === 'admin') return true;
  if (profile.role !== 'operator' && profile.role !== 'business') return false;
  if (account.pool === 'gcs') {
    return (profile.tg_brands || []).some((b) => sameOwner(b, account.brand));
  }
  return sameOwner(profile.tg_shooter_owner, account.owner);
}
