import { useEffect, useMemo, useRef, useState } from 'react';
import { Ticket } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { useTickets } from '../hooks/useTickets';
import { pendingOperatorTickets } from '../lib/ticket-pending';
import Toast from './Toast';

function formatSubmittedAt(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function playTone(ctx, { freq, at, dur, type = 'sine', peak = 0.22 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.012);
  gain.gain.linearRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Soft rising chime for new delivery tickets. */
function playTicketAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    playTone(ctx, { freq: 523.25, at: 0, dur: 0.22, type: 'triangle', peak: 0.18 });
    playTone(ctx, { freq: 659.25, at: 0.12, dur: 0.28, type: 'triangle', peak: 0.2 });
    playTone(ctx, { freq: 783.99, at: 0.24, dur: 0.4, type: 'triangle', peak: 0.16 });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    /* autoplay blocked or AudioContext unavailable */
  }
}

/** Header alert for new Business Delivery tickets (operator/admin). */
export default function TicketBell() {
  const { profile } = useAuth();
  const { site } = useSite();
  const navigate = useNavigate();
  const canSee = profile?.role === 'admin' || profile?.role === 'operator';
  const { data: tickets = [] } = useTickets(site, { enabled: canSee });
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const rootRef = useRef(null);
  const knownIdsRef = useRef(null);

  const pending = useMemo(
    () => (canSee ? pendingOperatorTickets(tickets, site) : []),
    [tickets, canSee, site],
  );

  // Alert when a new ticket appears while Bryan is on another page.
  useEffect(() => {
    if (!canSee) return;
    const ids = new Set(pending.map((t) => t.id));
    if (knownIdsRef.current == null) {
      knownIdsRef.current = ids;
      return;
    }
    const fresh = pending.filter((t) => !knownIdsRef.current.has(t.id));
    knownIdsRef.current = ids;
    if (fresh.length === 1) {
      const t = fresh[0];
      playTicketAlertSound();
      setToast(`New delivery ticket #${t.ticket_number || t.id} · ${t.account_name || 'account'}`);
    } else if (fresh.length > 1) {
      playTicketAlertSound();
      setToast(`${fresh.length} new delivery tickets awaiting review`);
    }
  }, [pending, canSee]);

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

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          className="header-bell-btn"
          aria-label={count ? `${count} delivery tickets awaiting review` : 'No delivery tickets pending'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Ticket size={18} strokeWidth={1.75} />
          {count > 0 && <span className="header-bell-dot" aria-hidden />}
        </button>

        {open && (
          <div className="header-bell-panel" role="menu">
            <div className="border-b border-ams-line px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ams-ink">Delivery tickets</p>
              <p className="text-[11px] text-ams-faint">
                {count ? `${count} awaiting IP review` : 'Nothing pending'}
              </p>
            </div>
            {count === 0 ? (
              <p className="px-3 py-4 text-[13px] text-ams-muted">No new business tickets right now.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {pending.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="header-bell-item" onClick={openTicket}>
                      <span className="font-semibold text-ams-ink">
                        #{t.ticket_number || t.id}
                        {' · '}
                        {t.account_name || '—'}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ams-muted">
                        {(t.staff || t.requester_name || 'Business')}
                        {t.submitted_at || t.created_at
                          ? ` · ${formatSubmittedAt(t.submitted_at || t.created_at)}`
                          : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-ams-line px-3 py-2">
              <button
                type="button"
                className="text-[12px] font-medium text-ams-accent hover:underline"
                onClick={openTicket}
              >
                Open Delivery tickets
              </button>
              <button
                type="button"
                className="text-[12px] font-medium text-ams-muted hover:text-ams-ink hover:underline"
                onClick={() => playTicketAlertSound()}
              >
                Play sound
              </button>
            </div>
          </div>
        )}
      </div>
      <Toast open={!!toast} message={toast} tone="warn" onClose={() => setToast('')} />
    </>
  );
}
