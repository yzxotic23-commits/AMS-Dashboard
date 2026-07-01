import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { useGovernanceDate } from '../context/GovernanceDateContext';
import { formatDateChip } from '../lib/governanceDateRange';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'custom', label: 'Custom' },
];

export default function GovernanceDateControls() {
  const {
    preset, from, to, fromInput, toInput, applyPreset, setCustomRange,
  } = useGovernanceDate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const showRangeChip = preset === 'custom';

  return (
    <div className="governance-date-ctl" ref={wrapRef}>
      <div className="site-switcher" role="group" aria-label="Date range preset">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? 'site-tab site-tab-active' : 'site-tab'}
            onClick={() => {
              if (p.id === 'custom') {
                applyPreset('custom');
                setOpen(true);
              } else {
                applyPreset(p.id);
                setOpen(false);
              }
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {showRangeChip && (
        <div className="governance-date-picker-wrap">
          <button
            type="button"
            className="governance-date-range"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`Custom range ${formatDateChip(from)} to ${formatDateChip(to)}`}
          >
            <Calendar size={14} className="governance-date-ic" aria-hidden />
            <span className="governance-date-val">{formatDateChip(from)}</span>
            <span className="governance-date-sep" aria-hidden>→</span>
            <span className="governance-date-val">{formatDateChip(to)}</span>
            <span className="governance-date-caret" aria-hidden>▾</span>
          </button>

          {open && (
            <div className="governance-date-popover" role="dialog" aria-label="Custom date range">
              <div className="governance-date-fields">
                <label className="governance-date-field">
                  <span>From</span>
                  <input
                    type="date"
                    value={fromInput}
                    onChange={(e) => setCustomRange(e.target.value, toInput)}
                  />
                </label>
                <label className="governance-date-field">
                  <span>To</span>
                  <input
                    type="date"
                    value={toInput}
                    onChange={(e) => setCustomRange(fromInput, e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary w-full"
                onClick={() => setOpen(false)}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
