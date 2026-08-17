import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useSite } from '../context/SiteContext';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { useAllAccounts } from '../hooks/useOperatorAccounts';
import { matchAccountForEngineSlot } from '../lib/engine-slot';
import { CURRENT_STATUS } from '../lib/feeding-audit';
import { SITES, getSiteChipClass } from '../lib/sites';

const PAGE_SIZES = [10, 20, 50];

const STATUS_LABEL = {
  active: CURRENT_STATUS.ACTIVE,
  restrict_scan: CURRENT_STATUS.RESTRICTED_SCAN,
  restrict_chat_new: CURRENT_STATUS.RESTRICTED_CHAT_NEW,
  banned: 'Banned',
};

const STATUS_BADGE = {
  active: 'badge-success',
  restrict_scan: 'badge-warn',
  restrict_chat_new: 'badge-warn',
  banned: 'badge-danger',
};

const LIVE_BADGE = {
  Feeding: 'badge-warn',
  Online: 'badge-success',
  Linking: 'badge-warn',
  'Session saved': 'badge-default',
  Offline: 'badge-default',
};

function kindFromAccount(account) {
  if (account?.status === 'BANNED') return 'banned';
  if (account?.restrict_kind === 'restrict_scan') return 'restrict_scan';
  if (account?.restrict_kind === 'restrict_chat_new') return 'restrict_chat_new';
  return 'active';
}

function slotLiveLabel(slot) {
  if (!slot) return 'Offline';
  if (slot.feedingActive) return 'Feeding';
  if (slot.linking) return 'Linking';
  if (slot.connected) return 'Online';
  if (slot.authSaved) return 'Session saved';
  return 'Offline';
}

/**
 * Read-only FeedFlow fleet Current Status — change status from Nurturing (Mark Strict).
 */
export default function FeedFlowAccountStatusPanel() {
  const { site } = useSite();
  const { data: engineData, isLoading: engineLoading, isFetching, refetch } = useEngineStatus();
  const { data: accounts = [], isLoading: accountsLoading } = useAllAccounts();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null); // active | restrict_scan | restrict_chat_new
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const slots = engineData?.slots || engineData?.accounts || [];
  const reachable = engineData?.reachable === true;

  const allRows = useMemo(() => {
    const scoped = site === 'all'
      ? accounts
      : accounts.filter((a) => a.siteKey === site);

    // Always list every FeedFlow engine slot (fleet view). Do not hide slots
    // just because AMS match is missing — that made a 20-slot engine look like 2.
    return (slots || []).map((slot) => {
      const account = matchAccountForEngineSlot(scoped, slot)
        || matchAccountForEngineSlot(accounts, slot);
      const label = slot.label
        || account?.account_name
        || `Account ${Number(slot.slot) + 1}`;
      return {
        slot,
        account,
        label,
        phone: slot.phone || account?.phone_number || '',
        kind: kindFromAccount(account),
        siteKey: account?.siteKey || null,
      };
    });
  }, [slots, accounts, site]);

  const rows = useMemo(() => {
    let list = allRows;
    if (statusFilter) {
      list = list.filter((row) => row.kind === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => {
      const name = String(row.label || '').toLowerCase();
      const phone = String(row.phone || '').toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [allRows, search, statusFilter]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, total);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [site, pageSize, search, statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setStatusFilter(null);
  }, [site]);

  const counts = useMemo(() => {
    const c = { active: 0, restrict_scan: 0, restrict_chat_new: 0, unmatched: 0 };
    for (const r of allRows) {
      if (!r.account) c.unmatched += 1;
      else c[r.kind] = (c[r.kind] || 0) + 1;
    }
    return c;
  }, [allRows]);

  function toggleStatusFilter(kind) {
    setStatusFilter((prev) => (prev === kind ? null : kind));
  }

  const loading = engineLoading || accountsLoading;
  const searchActive = search.trim().length > 0;
  const filterActive = Boolean(statusFilter);

  const chipBase = 'rounded-full px-2.5 py-1 transition-colors';
  const chipIdle = 'bg-ams-surface-muted text-ams-muted hover:bg-ams-line/60';
  const chipWarnIdle = 'bg-ams-warn/10 text-ams-warn hover:bg-ams-warn/20';
  const chipActiveSelected = 'bg-ams-success/15 text-ams-success ring-1 ring-ams-success/40';
  const chipWarnSelected = 'bg-ams-warn/20 text-ams-warn ring-1 ring-ams-warn/50';

  return (
    <section className="card mb-6 overflow-hidden">
      <div className="engine-panel-head !flex-nowrap !items-center border-b border-ams-line px-5 py-4">
        <div className="min-w-0 flex-1 pr-3">
          <h2 className="text-sm font-semibold text-ams-ink">Current Status (FeedFlow accounts)</h2>
          <p className="text-[11px] text-ams-faint">
            Real-time fleet view — change status from Nurturing (Mark Strict). Click a count to filter.
          </p>
        </div>
        <div className="engine-panel-actions !flex-nowrap shrink-0">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ams-faint"
              strokeWidth={2}
            />
            <input
              type="search"
              className="input h-8 w-[10.5rem] py-1 pl-8 pr-2 text-[12px] sm:w-[13rem]"
              placeholder="Search account…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search by account name"
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh engine"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-ams-line px-5 py-3 text-[12px]">
        <button
          type="button"
          className={`${chipBase} ${statusFilter === 'active' ? chipActiveSelected : chipIdle}`}
          aria-pressed={statusFilter === 'active'}
          onClick={() => toggleStatusFilter('active')}
        >
          Active <strong className={statusFilter === 'active' ? '' : 'text-ams-ink'}>{counts.active}</strong>
        </button>
        <button
          type="button"
          className={`${chipBase} ${statusFilter === 'restrict_scan' ? chipWarnSelected : chipWarnIdle}`}
          aria-pressed={statusFilter === 'restrict_scan'}
          onClick={() => toggleStatusFilter('restrict_scan')}
        >
          Restricted Scan <strong>{counts.restrict_scan}</strong>
        </button>
        <button
          type="button"
          className={`${chipBase} ${statusFilter === 'restrict_chat_new' ? chipWarnSelected : chipWarnIdle}`}
          aria-pressed={statusFilter === 'restrict_chat_new'}
          onClick={() => toggleStatusFilter('restrict_chat_new')}
        >
          Chat New Contact <strong>{counts.restrict_chat_new}</strong>
        </button>
        {!reachable && (
          <span className="rounded-full bg-ams-danger/10 px-2.5 py-1 text-ams-danger">
            Engine offline
          </span>
        )}
      </div>

      {loading ? (
        <p className="p-8 text-center text-sm text-ams-faint">Loading FeedFlow accounts…</p>
      ) : allRows.length === 0 ? (
        <p className="p-8 text-center text-sm text-ams-faint">
          No FeedFlow slots for this site. Link accounts in Nurturing scan-in first.
        </p>
      ) : rows.length === 0 && (searchActive || filterActive) ? (
        <p className="p-8 text-center text-sm text-ams-faint">
          {searchActive
            ? `No accounts match “${search.trim()}”.`
            : `No accounts with status ${STATUS_LABEL[statusFilter] || statusFilter}.`}
        </p>
      ) : (
        <>
          <div className="data-table-wrap">
            <table className={`data-table data-table--ff-status${site === 'all' ? ' data-table--ff-status-all' : ''}`}>
              <colgroup>
                <col className="ff-col-slot" />
                <col className="ff-col-acct" />
                <col className="ff-col-phone" />
                <col className="ff-col-live" />
                {site === 'all' && <col className="ff-col-site" />}
                <col className="ff-col-status" />
              </colgroup>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Account</th>
                  <th>Phone</th>
                  <th className="col-center">Live</th>
                  {site === 'all' && <th className="col-center">Site</th>}
                  <th className="col-center">Current Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const liveLabel = slotLiveLabel(row.slot);
                  const statusLabel = STATUS_LABEL[row.kind] || CURRENT_STATUS.ACTIVE;
                  return (
                    <tr key={`slot-${row.slot.slot}`}>
                      <td className="col-mono col-muted">{Number(row.slot.slot) + 1}</td>
                      <td className="font-medium text-ams-ink">{row.label}</td>
                      <td className="col-mono text-[12px]">{row.phone || '—'}</td>
                      <td className="col-center">
                        <span className={`badge ${LIVE_BADGE[liveLabel] || 'badge-default'}`}>
                          {liveLabel}
                        </span>
                      </td>
                      {site === 'all' && (
                        <td className="col-center">
                          {row.siteKey
                            ? <span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span>
                            : '—'}
                        </td>
                      )}
                      <td className="col-center">
                        {row.account ? (
                          <span className={`badge ${STATUS_BADGE[row.kind] || 'badge-default'}`}>
                            {statusLabel}
                          </span>
                        ) : (
                          <span className="text-[12px] text-ams-faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {total > 10 && (
            <div className="tk-pager border-t border-ams-line px-4 py-3">
              <label className="tk-pager-size">
                <span>Rows</span>
                <select
                  className="input tk-pager-size-select"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="Rows per page"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="tk-pager-actions">
                <span className="tk-pager-meta">
                  Showing {pageStart}–{pageEnd} of {total}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  Previous
                </button>
                <span className="tk-pager-page">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
