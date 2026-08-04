import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
  IP_MAX_BINDINGS,
  ipBindingCount,
  isIpSelectableForAccount,
} from '../lib/ip-ready';
import { formatProxyOptionLabel } from '../lib/proxy-display';

const FILTERS = [
  { id: 'available', label: 'Available' },
  { id: 'all', label: 'All' },
  { id: 'full', label: 'Full' },
];

function statusMeta(bound, selectable, isCurrent) {
  if (isCurrent) return { label: 'Current', className: 'badge badge-accent' };
  if (!selectable || bound >= IP_MAX_BINDINGS) {
    return { label: `${IP_MAX_BINDINGS}/${IP_MAX_BINDINGS} full`, className: 'badge badge-danger' };
  }
  if (bound === 1) return { label: '1/2', className: 'badge badge-warn' };
  return { label: 'Available', className: 'badge badge-success' };
}

/**
 * Searchable IP picker — reduces mis-selection vs long native <select>.
 */
export default function ProxyIpPicker({
  ips = [],
  bindings = {},
  value = '',
  onChange,
  accountIpId = null,
  allowEmpty = false,
  emptyLabel = 'No proxy',
  disabled = false,
  placeholder = 'Search IP, port, or username…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('available');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const selected = useMemo(
    () => ips.find((ip) => ip.id === value) || null,
    [ips, value],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ips
      .map((ip) => {
        const bound = ipBindingCount(ip, bindings);
        const selectable = isIpSelectableForAccount(ip, bindings, accountIpId);
        const isCurrent = ip.id === accountIpId;
        return { ip, bound, selectable, isCurrent };
      })
      .filter(({ ip, bound, selectable }) => {
        if (filter === 'available' && !selectable) return false;
        if (filter === 'full' && bound < IP_MAX_BINDINGS) return false;
        if (!q) return true;
        const hay = [
          ip.ip_address,
          ip.port,
          ip.username,
          ip.location,
          ip.site_key,
        ].map((x) => String(x || '').toLowerCase()).join(' ');
        return hay.includes(q);
      })
      .sort((a, b) => {
        // Selectable first, then free seats, then IP string
        if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
        if (a.bound !== b.bound) return a.bound - b.bound;
        return String(a.ip.ip_address || '').localeCompare(String(b.ip.ip_address || ''));
      });
  }, [ips, bindings, accountIpId, query, filter]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      // Prefer Available tab when opening; keep if user left All selected previously is ok
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  function pick(id) {
    onChange?.(id);
    setOpen(false);
  }

  const triggerLabel = selected
    ? formatProxyOptionLabel(selected)
    : (allowEmpty ? emptyLabel : 'Select proxy…');

  return (
    <div className={`proxy-ip-picker${disabled ? ' is-disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="proxy-ip-picker-trigger input"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={`proxy-ip-picker-trigger-text${selected ? '' : ' is-empty'}`}>
          {triggerLabel}
        </span>
        <ChevronDown size={16} className="proxy-ip-picker-chevron" strokeWidth={2} />
      </button>

      {open && (
        <div className="proxy-ip-picker-panel" role="listbox">
          <div className="proxy-ip-picker-search">
            <Search size={14} className="proxy-ip-picker-search-icon" strokeWidth={2} />
            <input
              ref={searchRef}
              type="search"
              className="input proxy-ip-picker-search-input"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search proxy IP"
            />
          </div>

          <div className="proxy-ip-picker-filters" role="tablist" aria-label="IP availability filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`proxy-ip-picker-filter${filter === f.id ? ' is-on' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="proxy-ip-picker-list">
            {allowEmpty && (
              <button
                type="button"
                className={`proxy-ip-picker-option${value === '' ? ' is-selected' : ''}`}
                onClick={() => pick('')}
              >
                <span className="proxy-ip-picker-option-main">{emptyLabel}</span>
              </button>
            )}
            {rows.length === 0 ? (
              <div className="proxy-ip-picker-empty">
                {ips.length === 0 ? 'No active IPs in ledger' : 'No IPs match this search'}
              </div>
            ) : rows.map(({ ip, bound, selectable, isCurrent }) => {
              const meta = statusMeta(bound, selectable, isCurrent);
              const blocked = !selectable;
              return (
                <button
                  key={ip.id}
                  type="button"
                  role="option"
                  aria-selected={value === ip.id}
                  disabled={blocked}
                  className={[
                    'proxy-ip-picker-option',
                    value === ip.id ? 'is-selected' : '',
                    blocked ? 'is-blocked' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => !blocked && pick(ip.id)}
                >
                  <span className="proxy-ip-picker-option-main">
                    <span className="proxy-ip-picker-ip font-mono">
                      {ip.ip_address}:{ip.port || '8080'}
                    </span>
                    <span className="proxy-ip-picker-user">{ip.username || '—'}</span>
                  </span>
                  <span className={meta.className}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
