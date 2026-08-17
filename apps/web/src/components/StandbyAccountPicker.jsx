import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

function phoneDigits(account) {
  if (account?.phone_number) return String(account.phone_number);
  const sim = String(account?.sim || '');
  const afterDot = sim.includes('·') ? sim.split('·').pop() : sim;
  return String(afterDot || '').trim() || '—';
}

function staffLabel(account) {
  return String(account?.staff || '').trim() || 'Unassigned';
}

function triggerLabel(account) {
  if (!account) return 'Select account…';
  const brand = account.brand ? `${account.brand} · ` : '';
  return `${brand}${account.account_name || '—'}`;
}

/**
 * Searchable standby account picker — grouped by Staff for Business delivery.
 */
export default function StandbyAccountPicker({
  accounts = [],
  value = '',
  onChange,
  disabled = false,
  placeholder = 'Search account, staff, phone, brand…',
  showStaffFilters = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [staffFilter, setStaffFilter] = useState('all');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const selected = useMemo(
    () => accounts.find((a) => a.id === value) || null,
    [accounts, value],
  );

  const staffOptions = useMemo(() => {
    const set = new Set();
    accounts.forEach((a) => set.add(staffLabel(a)));
    return [...set].sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((a) => {
        if (staffFilter !== 'all' && staffLabel(a) !== staffFilter) return false;
        if (!q) return true;
        const hay = [
          a.account_name,
          a.staff,
          a.owner,
          a.brand,
          a.phone_number,
          a.sim,
        ].map((x) => String(x || '').toLowerCase()).join(' ');
        return hay.includes(q);
      })
      .sort((a, b) => {
        const sa = staffLabel(a);
        const sb = staffLabel(b);
        if (sa !== sb) {
          if (sa === 'Unassigned') return 1;
          if (sb === 'Unassigned') return -1;
          return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
        }
        const brandCmp = String(a.brand || '').localeCompare(String(b.brand || ''));
        if (brandCmp) return brandCmp;
        return String(a.account_name || '').localeCompare(String(b.account_name || ''), undefined, {
          sensitivity: 'base',
        });
      });
  }, [accounts, query, staffFilter]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const a of filtered) {
      const key = staffLabel(a);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    return [...map.entries()];
  }, [filtered]);

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

  return (
    <div className={`standby-acct-picker${disabled ? ' is-disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="standby-acct-picker-trigger input"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={`standby-acct-picker-trigger-text${selected ? '' : ' is-empty'}`}>
          {selected ? (
            <>
              <span className="standby-acct-picker-trigger-main">{triggerLabel(selected)}</span>
              <span className="standby-acct-picker-trigger-sub">
                {staffLabel(selected)}
                {' · '}
                {phoneDigits(selected)}
              </span>
            </>
          ) : (
            'Select account…'
          )}
        </span>
        <ChevronDown size={16} className="standby-acct-picker-chevron" strokeWidth={2} />
      </button>

      {open && (
        <div className="standby-acct-picker-panel" role="listbox">
          <div className="standby-acct-picker-search">
            <Search size={14} className="standby-acct-picker-search-icon" strokeWidth={2} />
            <input
              ref={searchRef}
              type="search"
              className="input standby-acct-picker-search-input"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search standby accounts"
            />
          </div>

          {showStaffFilters && staffOptions.length > 1 && (
            <div className="standby-acct-picker-filters" role="group" aria-label="Filter by staff">
              <button
                type="button"
                className={`standby-acct-picker-filter${staffFilter === 'all' ? ' is-on' : ''}`}
                onClick={() => setStaffFilter('all')}
              >
                All staff
              </button>
              {staffOptions.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`standby-acct-picker-filter${staffFilter === name ? ' is-on' : ''}`}
                  onClick={() => setStaffFilter(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          <div className="standby-acct-picker-list">
            {groups.length === 0 ? (
              <div className="standby-acct-picker-empty">
                {accounts.length === 0
                  ? 'No standby accounts'
                  : (query.trim() || staffFilter !== 'all'
                    ? 'No accounts match this filter'
                    : 'No standby accounts')}
              </div>
            ) : groups.map(([staff, rows]) => (
              <div key={staff} className="standby-acct-picker-group">
                <div className="standby-acct-picker-group-head">
                  <span>{staff}</span>
                  <span className="standby-acct-picker-group-count">{rows.length}</span>
                </div>
                {rows.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={value === a.id}
                    className={`standby-acct-picker-option${value === a.id ? ' is-selected' : ''}`}
                    onClick={() => pick(a.id)}
                  >
                    <span className="standby-acct-picker-option-main">
                      <span className="standby-acct-picker-name">{a.account_name || '—'}</span>
                      <span className="standby-acct-picker-phone font-mono">{phoneDigits(a)}</span>
                    </span>
                    {a.brand ? (
                      <span className="badge badge-default">{a.brand}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
