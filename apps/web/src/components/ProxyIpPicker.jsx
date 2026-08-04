import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
  IP_MAX_BINDINGS,
  ipBindingCount,
  isIpSelectableForAccount,
} from '../lib/ip-ready';
import { formatProxyOptionLabel } from '../lib/proxy-display';

function normPort(port) {
  if (port == null || port === '') return '8080';
  return String(port);
}

/** One row per host:port — ledger sometimes has duplicate IP rows. */
function ipHostKey(ip) {
  return `${String(ip?.ip_address || '').trim().toLowerCase()}:${normPort(ip?.port)}`;
}

/**
 * Collapse duplicate ledger rows for the same IP into one option.
 * Occupancy = sum of bindings across duplicate ids (capped display via max seats).
 */
function dedupeIpRows(ips, bindings, accountIpId) {
  const groups = new Map();
  for (const ip of ips) {
    const key = ipHostKey(ip);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ip);
  }

  const rows = [];
  for (const group of groups.values()) {
    const bound = group.reduce((n, ip) => n + ipBindingCount(ip, bindings), 0);
    // Prefer the row already bound to this account, else the freest / first id
    let preferred = group.find((ip) => ip.id === accountIpId)
      || group.slice().sort((a, b) => {
        const ba = ipBindingCount(a, bindings);
        const bb = ipBindingCount(b, bindings);
        if (ba !== bb) return ba - bb;
        return String(a.id).localeCompare(String(b.id));
      })[0];
    const selectable = isIpSelectableForAccount(preferred, bindings, accountIpId)
      && (bound < IP_MAX_BINDINGS || preferred.id === accountIpId);
    rows.push({
      ip: preferred,
      bound: Math.min(bound, IP_MAX_BINDINGS),
      selectable,
      isCurrent: preferred.id === accountIpId,
    });
  }
  return rows;
}

function seatBadge(bound, isCurrent) {
  if (isCurrent) return { label: `${bound}/${IP_MAX_BINDINGS} · current`, className: 'badge badge-accent' };
  if (bound >= IP_MAX_BINDINGS) {
    return { label: `${IP_MAX_BINDINGS}/${IP_MAX_BINDINGS}`, className: 'badge badge-danger' };
  }
  if (bound === 1) return { label: '1/2', className: 'badge badge-warn' };
  return { label: '0/2', className: 'badge badge-success' };
}

/**
 * Simple IP picker: one row per IP, show 0/2 · 1/2, hide full (2/2).
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
  placeholder = 'Search IP or username…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const selected = useMemo(
    () => ips.find((ip) => ip.id === value) || null,
    [ips, value],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dedupeIpRows(ips, bindings, accountIpId)
      .filter(({ bound, isCurrent }) => {
        // Hide full IPs from the dropdown; keep current so the operator can see it
        if (bound >= IP_MAX_BINDINGS && !isCurrent) return false;
        return true;
      })
      .filter(({ ip }) => {
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
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        if (a.bound !== b.bound) return a.bound - b.bound;
        return String(a.ip.ip_address || '').localeCompare(String(b.ip.ip_address || ''));
      });
  }, [ips, bindings, accountIpId, query]);

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
                {ips.length === 0
                  ? 'No active IPs in ledger'
                  : (query.trim()
                    ? 'No IPs match this search'
                    : 'No free IP seats (all at 2/2)')}
              </div>
            ) : rows.map(({ ip, bound, selectable, isCurrent }) => {
              const meta = seatBadge(bound, isCurrent);
              const blocked = !selectable;
              return (
                <button
                  key={ipHostKey(ip)}
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
                      {ip.ip_address}:{normPort(ip.port)}
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
