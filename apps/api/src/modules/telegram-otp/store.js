import { supabaseAdmin } from '../../lib/supabase.js';

/** Same window the Telegram bot gives a /login request. */
export const OTP_REQUEST_TTL_MS = 5 * 60 * 1000;
/** How long a delivered code and password stay readable before they are wiped. */
export const OTP_VIEW_WINDOW_MS = 3 * 60 * 1000;
/** A sign-in reported later than this after delivery is not tied to the AMS request. */
export const LOGIN_CONFIRM_WINDOW_MS = 5 * 60 * 1000;
/** How long the "Login successful" state stays visible to the requester. */
export const LOGIN_SUCCESS_VISIBLE_MS = 60 * 1000;

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

/** A running scan with no progress report for this long is treated as dead (listener restarted). */
export const GROUP_SCAN_STALE_MS = 10 * 60 * 1000;
/** A queued scan Friday never picked up (listener down) is closed after this long. */
export const GROUP_SCAN_QUEUE_TTL_MS = 15 * 60 * 1000;

export async function purgeGroupScans() {
  const now = Date.now();
  const [stale, unclaimed] = await Promise.all([
    supabaseAdmin
      .from('tg_group_scans')
      .update({ status: 'failed', error: 'Friday stopped reporting progress', finished_at: new Date(now).toISOString() })
      .eq('status', 'running')
      .lt('heartbeat_at', new Date(now - GROUP_SCAN_STALE_MS).toISOString()),
    supabaseAdmin
      .from('tg_group_scans')
      .update({ status: 'failed', error: 'Friday did not pick up the scan', finished_at: new Date(now).toISOString() })
      .eq('status', 'queued')
      .lt('created_at', new Date(now - GROUP_SCAN_QUEUE_TTL_MS).toISOString()),
  ]);
  if (stale.error) throw stale.error;
  if (unclaimed.error) throw unclaimed.error;
}

export function sameOwner(a, b) {
  return Boolean(a && b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Only Ready accounts have a live bot session; others (Pending, Disconnected, Expired, …) never receive the code. */
export function isSessionReady(account) {
  return String(account?.status || '').trim().toLowerCase() === 'ready';
}

/** Admins: any account. Operators and Business: GCS accounts in their assigned currencies, shooter accounts of their own owner. */
export function isAssignedAccount(profile, account) {
  if (!profile || !account?.enabled) return false;
  if (profile.role === 'admin') return true;
  if (profile.role !== 'operator' && profile.role !== 'business') return false;
  if (account.pool === 'gcs') {
    return (profile.tg_currencies || []).some((c) => sameOwner(c, account.currency));
  }
  return sameOwner(profile.tg_shooter_owner, account.owner);
}
