import { useEffect, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReturnedStandbyNotices, useAccountMutations } from '../hooks/useOperatorAccounts';
import Toast from './Toast';

const MUTE_KEY = 'ams.businessNoticeMuted';
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
  gain.gain.linearRampToValueAtTime(peak, start + 0.02);
  gain.gain.linearRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function playNoticeAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    playTone(ctx, { freq: 587.33, at: 0, dur: 0.18, type: 'triangle', peak: 0.16 });
    playTone(ctx, { freq: 783.99, at: 0.14, dur: 0.28, type: 'triangle', peak: 0.18 });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    /* autoplay blocked or AudioContext unavailable */
  }
}

function noticeStamp(notice) {
  if (!notice?.at) return '';
  const d = new Date(notice.at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

/** Header bell for business: Restricted account is back on Standby and ready to scan. */
export default function BusinessNoticeBell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canSee = profile?.role === 'business';
  const pending = useReturnedStandbyNotices(canSee);
  const { ackNotice } = useAccountMutations();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [muted, setMuted] = useState(readMuted);
  const rootRef = useRef(null);
  const knownKeysRef = useRef(null);

  useEffect(() => {
    if (!canSee) return;
    const keys = new Set(pending.map((a) => `${a.id}:${a.business_notice?.at || ''}`));
    if (knownKeysRef.current == null) {
      knownKeysRef.current = keys;
      return;
    }
    const fresh = pending.filter((a) => !knownKeysRef.current.has(`${a.id}:${a.business_notice?.at || ''}`));
    knownKeysRef.current = keys;
    if (fresh.length === 1) {
      setToast(fresh[0].business_notice.title || `${fresh[0].account_name} is ready to scan again`);
    } else if (fresh.length > 1) {
      setToast(`${fresh.length} accounts are ready to scan again`);
    }
  }, [pending, canSee]);

  useEffect(() => {
    if (!canSee || muted || pending.length === 0) return undefined;

    const chimeIfVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      playNoticeAlertSound();
    };

    let id;
    const startDelay = setTimeout(() => {
      chimeIfVisible();
      id = setInterval(chimeIfVisible, CHIME_INTERVAL_MS);
    }, 2500);

    function onVis() {
      if (!document.hidden && pending.length > 0 && !muted) {
        playNoticeAlertSound();
      }
    }
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearTimeout(startDelay);
      if (id) clearInterval(id);
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

  function openTicket() {
    setOpen(false);
    navigate('/tickets');
  }

  async function dismiss(id, e) {
    e.stopPropagation();
    try {
      await ackNotice.mutateAsync({ id });
    } catch {
      /* keep the notice; next poll will retry */
    }
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
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          className="header-bell-btn"
          aria-label={count ? `${count} accounts ready to scan` : 'No accounts ready to scan'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <BellRing size={18} strokeWidth={1.75} />
          {count > 0 && <span className="header-bell-dot" aria-hidden />}
        </button>

        {open && (
          <div className="header-bell-panel" role="menu">
            <div className="border-b border-ams-line px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ams-ink">Ready to scan</p>
              <p className="text-[11px] text-ams-faint">
                {count ? `${count} back on Standby after restriction` : 'Nothing waiting'}
                {count > 0 && !muted ? ' · alert sound on' : ''}
                {count > 0 && muted ? ' · alerts muted' : ''}
              </p>
            </div>
            {count === 0 ? (
              <p className="px-3 py-4 text-[13px] text-ams-muted">No accounts waiting to be requested.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {pending.map((a) => (
                  <li key={`${a.id}:${a.business_notice?.at || ''}`}>
                    <button
                      type="button"
                      className="header-bell-item"
                      onClick={openTicket}
                    >
                      <span className="font-semibold text-ams-ink">
                        {a.business_notice.title || a.account_name}
                      </span>
                      {a.business_notice.body ? (
                        <span className="mt-0.5 block text-[11px] text-ams-muted">
                          {a.business_notice.body}
                        </span>
                      ) : null}
                      {noticeStamp(a.business_notice) ? (
                        <span className="mt-0.5 block text-[11px] text-ams-faint">
                          {noticeStamp(a.business_notice)}
                        </span>
                      ) : null}
                    </button>
                    <div className="px-3 pb-2">
                      <button
                        type="button"
                        className="text-[11px] font-medium text-ams-muted hover:text-ams-ink hover:underline"
                        onClick={(e) => dismiss(a.id, e)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-ams-line px-3 py-2">
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
      <Toast open={!!toast} message={toast} tone="warn" onClose={() => setToast('')} />
    </>
  );
}
