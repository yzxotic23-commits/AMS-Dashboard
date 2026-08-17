import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { useAllAccounts } from '../hooks/useOperatorAccounts';

const MUTE_KEY = 'ams.disconnectAlertMuted';
const CHIME_INTERVAL_MS = 10_000;

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function playTone(ctx, { freq, at, dur, type = 'sine', peak = 0.18 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function playDisconnectAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    playTone(ctx, { freq: 520, at: 0, dur: 0.12, type: 'triangle', peak: 0.16 });
    playTone(ctx, { freq: 390, at: 0.14, dur: 0.16, type: 'triangle', peak: 0.14 });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    /* ignore autoplay / audio errors */
  }
}

/** Header bell for pending disconnect reports (business + engine auto-detect). */
export default function DisconnectBell() {
  const { profile } = useAuth();
  const { site } = useSite();
  const navigate = useNavigate();
  const canSee = profile?.role === 'admin' || profile?.role === 'operator';
  const { data: accounts = [] } = useAllAccounts({ enabled: canSee, refetchInterval: 15_000 });
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const rootRef = useRef(null);

  const pending = useMemo(() => {
    if (!canSee) return [];
    return accounts
      .filter((a) => a.disconnect_report)
      .filter((a) => site === 'all' || a.siteKey === site || a.siteKey === 'all')
      .sort((a, b) => {
        const ta = new Date(a.disconnect_report?.reported_at || 0).getTime();
        const tb = new Date(b.disconnect_report?.reported_at || 0).getTime();
        return tb - ta;
      });
  }, [accounts, canSee, site]);

  useEffect(() => {
    if (!canSee || muted || pending.length === 0) return undefined;

    const chimeIfVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      playDisconnectAlertSound();
    };

    chimeIfVisible();
    const id = setInterval(chimeIfVisible, CHIME_INTERVAL_MS);

    function onVis() {
      if (!document.hidden && pending.length > 0 && !muted) {
        playDisconnectAlertSound();
      }
    }
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [pending.length, canSee, muted]);

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

  function openReport(id) {
    setOpen(false);
    navigate(`/accounts?open=${encodeURIComponent(id)}`);
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

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="header-bell-btn"
        aria-label={count ? `${count} disconnect reports` : 'No disconnect reports'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} strokeWidth={1.75} />
        {count > 0 && <span className="header-bell-dot" aria-hidden />}
      </button>

      {open && (
        <div className="header-bell-panel" role="menu">
          <div className="border-b border-ams-line px-3 py-2.5">
            <p className="text-[13px] font-semibold text-ams-ink">Disconnect reports</p>
            <p className="text-[11px] text-ams-faint">
              {count ? `${count} awaiting R&M review` : 'Nothing pending'}
              {count > 0 && !muted ? ' · alert sound on' : ''}
              {count > 0 && muted ? ' · alerts muted' : ''}
            </p>
          </div>
          {count === 0 ? (
            <p className="px-3 py-4 text-[13px] text-ams-muted">No disconnect reports right now.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {pending.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="header-bell-item"
                    onClick={() => openReport(a.id)}
                  >
                    <span className="font-semibold text-ams-ink">{a.account_name}</span>
                    <span className="mt-0.5 block text-[11px] text-ams-muted">
                      {a.disconnect_report.reported_by || a.staff || 'Business'}
                      {' · '}
                      {new Date(a.disconnect_report.reported_at).toLocaleString()}
                    </span>
                    {a.disconnect_report.note ? (
                      <span className="mt-0.5 block truncate text-[11px] text-ams-faint">
                        {a.disconnect_report.note}
                      </span>
                    ) : null}
                    {a.status === 'LOGGED_OUT' ? (
                      <span className="mt-0.5 block text-[11px] font-medium text-ams-warn">
                        Status · Logged out (confirm Restricted / Banned if needed)
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-ams-line px-3 py-2">
            <button
              type="button"
              className="text-[12px] font-medium text-ams-accent hover:underline"
              onClick={() => {
                setOpen(false);
                navigate('/accounts');
              }}
            >
              Open Resource Ledger
            </button>
            <button
              type="button"
              className="text-[12px] font-medium text-ams-muted hover:text-ams-ink hover:underline"
              onClick={toggleMute}
            >
              {muted ? 'Unmute alerts' : 'Mute alerts'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
