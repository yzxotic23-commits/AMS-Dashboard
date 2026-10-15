import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Eye, Loader2, Radar, Search, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Drawer from './Drawer';
import IconTooltip from './IconTooltip';
import Toast from './Toast';
import api from '../lib/api';
import { downloadFromApi } from '../lib/download';
import { useAuth } from '../context/AuthContext';

const ACCOUNTS_KEY = ['telegram-otp', 'groups', 'accounts'];
const OPEN_SCAN = new Set(['queued', 'running']);

const VIEW_FILTERS = [
  { id: 'all', label: 'All accounts' },
  { id: 'never', label: 'Never scanned' },
  { id: 'junk', label: 'Has junk groups' },
  { id: 'missing', label: 'Missing master groups' },
  { id: 'not_admin', label: 'Not admin somewhere' },
];

const GROUP_STATES = [
  { id: 'all', label: 'All' },
  { id: 'junk', label: 'Junk' },
  { id: 'not_admin', label: 'Not admin' },
  { id: 'missing', label: 'Missing' },
  { id: 'ok', label: 'Admin' },
];

const STATE_BADGES = {
  ok: ['badge-success', 'Admin'],
  not_admin: ['badge-warn', 'Not admin'],
  junk: ['badge-danger', 'Junk'],
  missing: ['badge-default', 'Missing'],
};

function formatAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
}

function isReady(account) {
  return String(account.status || '').trim().toLowerCase() === 'ready';
}

function SessionBadge({ status }) {
  if (String(status || '').trim().toLowerCase() === 'ready') {
    return <span className="badge badge-success">Active</span>;
  }
  return <span className="badge badge-warn">{status || 'Unknown'}</span>;
}

function Count({ value, tone }) {
  if (value == null) return <span className="text-ams-faint">—</span>;
  const cls = value > 0 && tone ? `font-semibold ${tone}` : 'text-ams-ink';
  return <span className={`tabular-nums ${cls}`}>{value}</span>;
}

function AccountCell({ account }) {
  if (account.profile && account.profile !== account.id) {
    return (
      <>
        <div className="text-[13.5px] font-medium text-ams-ink">{account.profile}</div>
        <div className="font-mono text-[12px] text-ams-faint">{account.id}</div>
      </>
    );
  }
  return <div className="font-mono text-[13px] text-ams-ink">{account.id}</div>;
}

function ScanProgress({ scan }) {
  if (scan.status === 'queued') return <span>Waiting for Friday…</span>;
  return (
    <span className="tabular-nums">
      Scanning {scan.progress_done || 0}
      {scan.progress_total ? ` / ${scan.progress_total}` : ''}
    </span>
  );
}

export default function TelegramGroupsTab() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('all');
  const [view, setView] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState(null);
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('default');

  function notify(message, tone = 'default') {
    setToastTone(tone);
    setToast(message);
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => (await api.get('/telegram-otp/groups/accounts')).data,
    refetchInterval: (query) => (
      (query.state.data?.data || []).some((a) => OPEN_SCAN.has(a.scan?.status)) ? 3000 : 60_000
    ),
  });
  const accounts = data?.data || [];

  const brands = useMemo(
    () => [...new Set(accounts.map((a) => a.brand).filter(Boolean))].sort(),
    [accounts],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/[\s+-]/g, '');
    return accounts.filter((a) => {
      if (brand !== 'all' && a.brand !== brand) return false;
      if (view === 'never' && a.scanned_at) return false;
      if (['junk', 'missing', 'not_admin'].includes(view) && !(a[view] > 0)) return false;
      if (!q) return true;
      return [a.id, a.profile, a.phone]
        .some((v) => String(v || '').toLowerCase().replace(/[\s+-]/g, '').includes(q));
    });
  }, [accounts, search, brand, view]);

  useEffect(() => {
    setPage(1);
  }, [search, brand, view, pageSize]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, total);
  const pageRows = rows.slice(pageStart - 1, pageEnd);
  const scannedCount = accounts.filter((a) => a.scanned_at).length;

  const openScans = useRef(new Map());
  useEffect(() => {
    for (const a of accounts) {
      const wasOpen = openScans.current.get(a.id);
      const status = a.scan?.status;
      if (wasOpen && status === 'done') {
        notify(`${a.id}: ${a.group_count ?? 0} groups scanned`);
        qc.invalidateQueries({ queryKey: ['telegram-otp', 'groups', 'detail', a.id] });
      }
      if (wasOpen && status === 'failed') notify(`${a.id}: scan failed — ${a.scan.error || 'unknown error'}`, 'error');
      openScans.current.set(a.id, OPEN_SCAN.has(status));
    }
  }, [accounts, qc]);

  const scanMut = useMutation({
    mutationFn: (accountId) => api.post('/telegram-otp/groups/scans', { account_id: accountId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
    onError: (err) => notify(err.response?.data?.error || err.message || 'Could not start the scan', 'error'),
  });

  const cancelMut = useMutation({
    mutationFn: (scanId) => api.post(`/telegram-otp/groups/scans/${scanId}/cancel`).then((r) => r.data),
    onSuccess: () => {
      notify('Scan cancelled — the previous group list is kept');
      qc.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
    onError: (err) => notify(err.response?.data?.error || err.message || 'Could not cancel the scan', 'error'),
  });

  return (
    <div>
      <div className="page-filter-bar">
        <div className="page-filter-search !flex-none w-full max-w-xs">
          <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
          <input
            className="input"
            type="search"
            placeholder="Search ID, name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search GCS accounts"
          />
        </div>
        <label className="page-filter-chip">
          <select className="page-filter-chip-select" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Filter by brand">
            <option value="all">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="page-filter-chip">
          <select className="page-filter-chip-select" value={view} onChange={(e) => setView(e.target.value)} aria-label="Filter by scan result">
            {VIEW_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <div className="page-meta-bubble ml-auto">
          <span className="font-semibold text-ams-ink">{scannedCount}</span>
          <span>of</span>
          <span className="font-semibold text-ams-ink">{accounts.length}</span>
          <span>GCS accounts scanned</span>
        </div>
      </div>

      {isLoading && <div className="py-12 text-center text-sm text-ams-muted">Loading GCS accounts…</div>}

      {isError && (
        <div className="card px-5 py-4 text-sm text-ams-danger">
          Could not load GCS accounts — {error?.response?.data?.error || error?.message}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="data-panel card overflow-hidden">
          <div className="data-table-wrap">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Brand</th>
                  <th>Friday session</th>
                  <th className="text-right">Groups</th>
                  <th className="text-right">Admin</th>
                  <th className="text-right">Junk</th>
                  <th className="text-right">Missing</th>
                  <th className="text-right">Not admin</th>
                  <th>Last scan</th>
                  <th className="col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-cell">
                      {accounts.length === 0 ? 'No GCS accounts yet.' : 'No accounts match this filter.'}
                    </td>
                  </tr>
                ) : pageRows.map((a) => {
                  const scan = a.scan;
                  const open = OPEN_SCAN.has(scan?.status);
                  return (
                    <tr key={a.id}>
                      <td><AccountCell account={a} /></td>
                      <td>{a.brand || '—'}</td>
                      <td><SessionBadge status={a.status} /></td>
                      <td className="text-right"><Count value={a.group_count} /></td>
                      <td className="text-right"><Count value={a.admin_count} /></td>
                      <td className="text-right"><Count value={a.junk} tone="text-ams-danger" /></td>
                      <td className="text-right"><Count value={a.missing} tone="text-ams-warn" /></td>
                      <td className="text-right"><Count value={a.not_admin} tone="text-ams-warn" /></td>
                      <td className="text-[13px] text-ams-muted">
                        {open ? (
                          <span className="inline-flex items-center gap-1.5 text-ams-ink">
                            <Loader2 size={13} className="animate-spin" />
                            <ScanProgress scan={scan} />
                          </span>
                        ) : (
                          <>
                            <div>{formatAgo(a.scanned_at)}</div>
                            {scan?.status === 'failed' && (
                              <IconTooltip label={scan.error || 'Scan failed'}>
                                <span className="badge badge-danger mt-0.5">Last scan failed</span>
                              </IconTooltip>
                            )}
                          </>
                        )}
                      </td>
                      <td className="col-action">
                        <div className="inline-flex items-center gap-1.5">
                          {open ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm justify-center"
                              onClick={() => cancelMut.mutate(scan.id)}
                              disabled={cancelMut.isPending}
                            >
                              <X size={13} strokeWidth={2.25} />
                              Cancel
                            </button>
                          ) : isReady(a) ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm justify-center"
                              onClick={() => scanMut.mutate(a.id)}
                              disabled={scanMut.isPending && scanMut.variables === a.id}
                            >
                              <Radar size={13} strokeWidth={2.25} />
                              Scan
                            </button>
                          ) : (
                            <IconTooltip label="Friday has no live session for this account.">
                              <button type="button" className="btn btn-secondary btn-sm justify-center" disabled>
                                <Radar size={13} strokeWidth={2.25} />
                                Scan
                              </button>
                            </IconTooltip>
                          )}
                          {a.scanned_at && (
                            <IconTooltip label="View groups">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm justify-center"
                                onClick={() => setDetailId(a.id)}
                                aria-label={`View groups of ${a.id}`}
                              >
                                <Eye size={14} strokeWidth={2.25} />
                              </button>
                            </IconTooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > 0 && (
            <div className="tk-pager px-4 pb-4">
              <label className="tk-pager-size">
                <span>Rows</span>
                <select
                  className="input tk-pager-size-select"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="Rows per page"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
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
        </div>
      )}

      <GroupsDrawer
        accountId={detailId}
        canExport={!!profile?.can_export}
        onClose={() => setDetailId(null)}
        notify={notify}
      />

      <Toast open={!!toast} message={toast} tone={toastTone} onClose={() => setToast('')} />
    </div>
  );
}

function GroupsDrawer({ accountId, canExport, onClose, notify }) {
  const [state, setState] = useState('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setState('all');
    setSearch('');
  }, [accountId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['telegram-otp', 'groups', 'detail', accountId],
    queryFn: async () => (await api.get(`/telegram-otp/groups/accounts/${encodeURIComponent(accountId)}`)).data,
    enabled: !!accountId,
  });

  const all = useMemo(() => [...(data?.groups || []), ...(data?.missing || [])], [data]);
  const counts = useMemo(() => {
    const c = { all: all.length, ok: 0, not_admin: 0, junk: 0, missing: 0 };
    for (const g of all) c[g.state] += 1;
    return c;
  }, [all]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((g) => (state === 'all' || g.state === state)
      && (!q || [g.group_name, g.group_id].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [all, state, search]);

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      notify('Invite link copied');
    } catch {
      notify('Could not copy the invite link', 'error');
    }
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadFromApi(
        `/telegram-otp/groups/accounts/${encodeURIComponent(accountId)}/export`,
        `tg-groups-${accountId}-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      notify('Group list exported');
    } catch (err) {
      notify(err.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  const account = data?.account;

  return (
    <Drawer
      open={!!accountId}
      title={`Groups · ${account?.profile && account.profile !== account.id ? `${account.profile} (${account.id})` : accountId || ''}`}
      onClose={onClose}
      size="ticket"
      footer={(
        <>
          {canExport && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={exporting || !data}>
              <Download size={15} strokeWidth={2.25} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </>
      )}
    >
      {isLoading && <div className="py-10 text-center text-sm text-ams-muted">Loading groups…</div>}
      {isError && (
        <div className="text-sm text-ams-danger">
          Could not load groups — {error?.response?.data?.error || error?.message}
        </div>
      )}
      {data && (
        <div className="space-y-4">
          <p className="text-[13px] text-ams-muted">
            {account?.brand || 'No brand'} master has <span className="font-semibold text-ams-ink">{data.master_count}</span> groups
            {' '}(groups where a {account?.brand || ''} GCS account is admin and has an invite link).
            {data.scan?.finished_at && <> Scanned {formatAgo(data.scan.finished_at)}.</>}
          </p>

          <div className="page-tab-bar" role="tablist" aria-label="Group state">
            {GROUP_STATES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={state === id}
                className={state === id ? 'page-tab page-tab-active' : 'page-tab'}
                onClick={() => setState(id)}
              >
                {label}
                <span className="page-tab-badge">{counts[id]}</span>
              </button>
            ))}
          </div>

          <div className="page-filter-search">
            <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
            <input
              className="input"
              type="search"
              placeholder="Search group name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search groups"
            />
          </div>

          <div className="data-table-wrap">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Group</th>
                  <th className="text-right">Members</th>
                  <th>State</th>
                  <th className="col-action">Invite link</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={4} className="empty-cell">No groups in this view.</td></tr>
                ) : shown.map((g) => {
                  const [tone, label] = STATE_BADGES[g.state] || ['badge-default', g.state];
                  return (
                    <tr key={`${g.state}-${g.group_id}`}>
                      <td>
                        <div className="text-[13.5px] font-medium text-ams-ink">{g.group_name || 'Untitled group'}</div>
                        <div className="font-mono text-[12px] text-ams-faint">
                          {g.group_id}
                          {g.is_owner ? ' · owner' : ''}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{g.member_count ?? '—'}</td>
                      <td><span className={`badge ${tone}`}>{label}</span></td>
                      <td className="col-action">
                        {g.invite_link ? (
                          <IconTooltip label={g.invite_link}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm justify-center"
                              onClick={() => copy(g.invite_link)}
                              aria-label="Copy invite link"
                            >
                              <Copy size={13} strokeWidth={2.25} />
                            </button>
                          </IconTooltip>
                        ) : <span className="text-ams-faint">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}
