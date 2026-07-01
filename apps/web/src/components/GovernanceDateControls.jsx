import { useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { useGovernanceDate } from '../context/GovernanceDateContext';
import { formatRangeShort } from '../lib/governanceDateRange';

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

  return (
    <div className="governance-date-ctl" ref={wrapRef}>
      <div className="governance-date-quick" role="group" aria-label="Date range preset">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? 'on' : ''}
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

      <div className="governance-date-picker-wrap">
        <button
          type="button"
          className="governance-date-range"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Calendar size={14} className="shrink-0 opacity-70" aria-hidden />
          <span className="governance-date-val">{formatRangeShort(from, to)}</span>
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
    </div>
  );
}
