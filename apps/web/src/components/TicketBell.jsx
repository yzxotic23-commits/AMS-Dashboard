import { useEffect, useMemo, useRef, useState } from 'react';
import { Ticket } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { useTickets } from '../hooks/useTickets';
import { pendingOperatorTickets, pendingBusinessConfirmTickets } from '../lib/ticket-pending';
import { formatDurationShort } from '../lib/ticket-timing';
import { profileStaffScope, accountInStaffScope } from '../lib/account-staff';
import {
  bindAudioUnlock,
  playTicketAlertSound,
  ensureNotificationPermission,
  notificationPermission,
  showDesktopNotification,
  setPendingTitleFlash,
  clearPendingTitleFlash,
} from '../lib/alert-notify';
import Toast from './Toast';

const MUTE_KEY = 'ams.ticketAlertMuted';
const CHIME_INTERVAL_MS = 8_000;
const DESKTOP_NUDGE_MS = 25_000;

function formatAgo(value) {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const text = formatDurationShort(Math.max(0, Date.now() - t));
  return text ? `${text} ago` : '';
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function notifyDesktopTickets({ isBusiness, fresh, pendingCount, onOpen }) {
  const title = isBusiness ? 'AMS · Confirm live' : 'AMS · Delivery ticket';
  let body;
  if (fresh?.length === 1) {
    const t = fresh[0];
    body = isBusiness
      ? `${t.account_name || 'Account'} is live — confirm delivery`
      : `New ticket #${t.ticket_number || t.id} · ${t.account_name || 'account'}`;
  } else if (fresh?.length > 1) {
    body = isBusiness
      ? `${fresh.length} tickets awaiting your confirm`
      : `${fresh.length} new delivery tickets awaiting review`;
  } else {
    body = isBusiness
      ? `${pendingCount} awaiting your confirm`
      : `${pendingCount} ticket${pendingCount === 1 ? '' : 's'} awaiting IP review`;
  }
  showDesktopNotification({
    title,
    body,
    tag: isBusiness ? 'ams-ticket-business' : 'ams-ticket-resource',
    onClick: onOpen,
  });
}

/** Header alert: operator reviews new tickets; business confirms go-live. */
export default function TicketBell() {
  const { profile } = useAuth();
  const { site } = useSite();
  const navigate = useNavigate();
  const isBusiness = profile?.role === 'business';
  const canSee = isBusiness || profile?.role === 'admin' || profile?.role === 'operator';
  const staffScope = useMemo(() => profileStaffScope(profile), [profile]);
  const { data: tickets = [] } = useTickets(site, { enabled: canSee });
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [muted, setMuted] = useState(readMuted);
  const [tick, setTick] = useState(0);
  const [notifPerm, setNotifPerm] = useState(notificationPermission);
  const rootRef = useRef(null);
  const knownIdsRef = useRef(null);

  const pending = useMemo(() => {
    if (!canSee) return [];
    const rows = isBusiness
      ? pendingBusinessConfirmTickets(tickets, site)
      : pendingOperatorTickets(tickets, site);
    if (!staffScope) return rows;
    return rows.filter((t) => accountInStaffScope(t, staffScope));
  }, [tickets, canSee, isBusiness, site, staffScope]);

  useEffect(() => {
    bindAudioUnlock();
  }, []);

  useEffect(() => () => clearPendingTitleFlash(), []);

  // Title flash + desktop nudge while backlog exists (works with tab in background).
  useEffect(() => {
    if (!canSee) return undefined;
    const label = isBusiness ? 'confirm' : 'ticket';
    setPendingTitleFlash(pending.length, label);

    if (muted || pending.length === 0) return undefined;

    const nudge = () => {
      if (typeof document !== 'undefined' && !document.hidden) return;
      notifyDesktopTickets({
        isBusiness,
        pendingCount: pending.length,
        onOpen: () => navigate('/tickets'),
      });
    };

    const id = setInterval(nudge, DESKTOP_NUDGE_MS);
    return () => clearInterval(id);
  }, [pending.length, canSee, muted, isBusiness, navigate]);

  // Toast + sound + desktop notification when a new pending ticket appears.
  useEffect(() => {
    if (!canSee) return;
    const ids = new Set(pending.map((t) => t.id));
    if (knownIdsRef.current == null) {
      knownIdsRef.current = ids;
      return;
    }
    const fresh = pending.filter((t) => !knownIdsRef.current.has(t.id));
    knownIdsRef.current = ids;
    if (!fresh.length) return;

    if (fresh.length === 1) {
      const t = fresh[0];
      setToast(isBusiness
        ? `${t.account_name || 'Account'} is live — confirm delivery`
        : `New delivery ticket #${t.ticket_number || t.id} · ${t.account_name || 'account'}`);
    } else {
      setToast(isBusiness
        ? `${fresh.length} tickets awaiting your confirm`
        : `${fresh.length} new delivery tickets awaiting review`);
    }

    if (!muted) {
      playTicketAlertSound();
      notifyDesktopTickets({
        isBusiness,
        fresh,
        pendingCount: pending.length,
        onOpen: () => navigate('/tickets'),
      });
    }
  }, [pending, canSee, isBusiness, muted, navigate]);

  // Repeat chime while pending (also try when tab becomes visible again).
  useEffect(() => {
    if (!canSee || muted || pending.length === 0) return undefined;

    const chime = () => {
      playTicketAlertSound();
    };

    chime();
    const id = setInterval(chime, CHIME_INTERVAL_MS);

    function onVis() {
      if (!document.hidden && pending.length > 0 && !muted) chime();
    }
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [pending.length, canSee, muted]);

  useEffect(() => {
    if (!canSee || pending.length === 0) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [canSee, pending.length]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canSee) return null;

  const count = pending.length;
  void tick;

  function openTicket() {
    setOpen(false);
    navigate('/tickets');
  }

  function toggleMute() {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function enableDesktopAlerts() {
    bindAudioUnlock();
    playTicketAlertSound();
    const perm = await ensureNotificationPermission();
    setNotifPerm(perm);
    if (perm === 'granted' && count > 0 && !muted) {
      notifyDesktopTickets({
        isBusiness,
        pendingCount: count,
        onOpen: openTicket,
      });
    }
  }

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          className="header-bell-btn"
          aria-label={count
            ? (isBusiness
              ? `${count} tickets awaiting your confirm`
              : `${count} delivery tickets awaiting review`)
            : (isBusiness ? 'No tickets to confirm' : 'No delivery tickets pending')}
          aria-expanded={open}
          onClick={() => {
            bindAudioUnlock();
            setOpen((v) => !v);
          }}
        >
          <Ticket size={18} strokeWidth={1.75} />
          {count > 0 && <span className="header-bell-dot" aria-hidden />}
        </button>

        {open && (
          <div className="header-bell-panel" role="menu">
            <div className="border-b border-ams-line px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ams-ink">
                {isBusiness ? 'Confirm live' : 'Delivery tickets'}
              </p>
              <p className="text-[11px] text-ams-faint">
                {count
                  ? (isBusiness
                    ? `${count} awaiting your confirm`
                    : `${count} awaiting IP review`)
                  : 'Nothing pending'}
                {count > 0 && !muted ? ' · alert sound on' : ''}
                {count > 0 && muted ? ' · alerts muted' : ''}
              </p>
            </div>
            {count === 0 ? (
              <p className="px-3 py-4 text-[13px] text-ams-muted">
                {isBusiness
                  ? 'No tickets waiting for your confirm.'
                  : 'No new business tickets right now.'}
              </p>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {pending.map((t) => {
                  const ago = formatAgo(
                    isBusiness
                      ? (t.in_progress_at || t.updated_at || t.submitted_at || t.created_at)
                      : (t.submitted_at || t.created_at),
                  );
                  const ticketNo = t.ticket_number || t.id;
                  return (
                    <li key={t.id}>
                      <button type="button" className="header-bell-item" onClick={openTicket}>
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ams-ink">
                              {t.account_name || '—'}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-ams-muted">
                              #{ticketNo}
                              {ago ? ` · ${ago}` : ''}
                              {!isBusiness && t.staff ? ` · ${t.staff}` : ''}
                            </span>
                          </span>
                          <span className={`mt-0.5 shrink-0 text-[10px] font-semibold ${isBusiness ? 'text-ams-accent' : 'text-ams-warn'}`}>
                            {isBusiness ? 'Pending' : 'Review'}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-col gap-1.5 border-t border-ams-line px-3 py-2">
              {notifPerm === 'default' && (
                <button
                  type="button"
                  className="text-left text-[12px] font-medium text-ams-accent hover:underline"
                  onClick={enableDesktopAlerts}
                >
                  Enable desktop alerts (works in background)
                </button>
              )}
              {notifPerm === 'denied' && (
                <p className="text-[11px] text-ams-faint">
                  Desktop alerts blocked in browser settings — allow notifications for this site.
                </p>
              )}
              {notifPerm === 'unsupported' && (
                <p className="text-[11px] text-ams-faint">This browser does not support desktop notifications.</p>
              )}
              <div className={`flex items-center gap-2 ${isBusiness ? 'justify-end' : 'justify-between'}`}>
                {!isBusiness && (
                  <button
                    type="button"
                    className="text-[12px] font-medium text-ams-accent hover:underline"
                    onClick={openTicket}
                  >
                    Open Delivery tickets
                  </button>
                )}
                <button
                  type="button"
                  className="text-[12px] font-medium text-ams-muted hover:text-ams-ink hover:underline"
                  onClick={toggleMute}
                >
                  {muted ? 'Unmute alerts' : 'Mute alerts'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Toast open={!!toast} message={toast} tone="warn" onClose={() => setToast('')} />
    </>
  );
}
