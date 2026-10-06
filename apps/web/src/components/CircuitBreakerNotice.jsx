import { useEffect, useState } from 'react';
import { OctagonAlert, X } from 'lucide-react';
import { BREAKER_CONFIRM_EVENT, BREAKER_PAUSED_EVENT, confirmBreaker } from '../lib/api';

const CONFIRM_WORD = 'CONFIRM';

/**
 * Circuit-breaker UI. Manual batches past the limit get a typed confirmation;
 * paused automation shows a banner with an explicit resume.
 */
export default function CircuitBreakerNotice() {
  const [ask, setAsk] = useState(null);
  const [typed, setTyped] = useState('');
  const [paused, setPaused] = useState({});

  useEffect(() => {
    const onConfirm = (e) => {
      setTyped('');
      setAsk(e.detail);
    };
    const onPaused = (e) => setPaused((p) => ({ ...p, [e.detail.kind]: e.detail }));
    window.addEventListener(BREAKER_CONFIRM_EVENT, onConfirm);
    window.addEventListener(BREAKER_PAUSED_EVENT, onPaused);
    return () => {
      window.removeEventListener(BREAKER_CONFIRM_EVENT, onConfirm);
      window.removeEventListener(BREAKER_PAUSED_EVENT, onPaused);
    };
  }, []);

  function decide(ok) {
    ask?.resolve(ok);
    setAsk(null);
  }

  function resume(kind) {
    const d = paused[kind];
    confirmBreaker(kind, d?.window_minutes || 10);
    setPaused(({ [kind]: _removed, ...rest }) => rest);
  }

  const pausedList = Object.values(paused);

  return (
    <>
      {ask && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-6">
          <div className="card w-full max-w-md p-6">
            <div className="mb-3 flex items-center gap-2">
              <OctagonAlert size={22} strokeWidth={2} className="text-ams-danger" />
              <h2 className="text-base font-bold text-ams-ink">Large batch paused</h2>
            </div>
            <p className="mb-3 text-sm text-ams-muted">
              More than <strong className="text-ams-ink">{ask.limit} {ask.label}</strong> in the last {ask.window_minutes} minutes.
              These actions cannot be undone, so AMS stopped to make sure this is intended.
            </p>
            <p className="mb-2 text-[13px] text-ams-muted">
              Type <span className="font-mono font-semibold text-ams-ink">{CONFIRM_WORD}</span> to continue for the next {ask.window_minutes} minutes.
            </p>
            <input
              className="input mb-4 w-full font-mono"
              value={typed}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed === CONFIRM_WORD) decide(true); }}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => decide(false)}>Stop here</button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={typed !== CONFIRM_WORD}
                onClick={() => decide(true)}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {pausedList.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[900] w-[360px] space-y-2">
          {pausedList.map((d) => (
            <div key={d.kind} className="card border border-ams-danger/40 p-4 shadow-lg">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-ams-ink">
                  <OctagonAlert size={16} strokeWidth={2} className="text-ams-danger" />
                  Automation paused
                </div>
                <button
                  type="button"
                  className="table-icon-btn"
                  aria-label="Dismiss"
                  onClick={() => setPaused(({ [d.kind]: _removed, ...rest }) => rest)}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="mb-3 text-[12.5px] text-ams-muted">
                Automatic {d.label} exceeded {d.limit} in {d.window_minutes} minutes. Check the accounts are really affected before resuming.
              </p>
              <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => resume(d.kind)}>
                Resume for {d.window_minutes} min
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
