import { useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, Loader2, Search } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import DetailDialog from '../components/DetailDialog';
import IconTooltip from '../components/IconTooltip';
import Toast from '../components/Toast';
import api from '../lib/api';

function formatAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
}

function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const STATUS_TONES = {
  ready: 'badge-success',
  disconnected: 'badge-warn',
  pending: 'badge-default',
  'pending login': 'badge-default',
  expired: 'badge-danger',
  banned: 'badge-danger',
  frozen: 'badge-danger',
};

function isReady(account) {
  return String(account.status || '').trim().toLowerCase() === 'ready';
}

function StatusBadge({ status }) {
  const key = String(status || '').trim().toLowerCase();
  const label = key === 'ready' ? 'Active' : status || 'Unknown';
  return <span className={`badge ${STATUS_TONES[key] || 'badge-default'}`}>{label}</span>;
}

function PoolBadge({ account }) {
  if (account.pool === 'shooter') {
    return <span className="badge badge-default">Shooter{account.owner ? ` · ${account.owner}` : ''}</span>;
  }
  return <span className="badge badge-default">GCS</span>;
}

export default function TelegramOtpPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [pool, setPool] = useState('all');
  const [brand, setBrand] = useState('all');
  const [owner, setOwner] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [requestId, setRequestId] = useState(null);
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('default');

  const { data: roster, isLoading, isError, error } = useQuery({
    queryKey: ['telegram-otp', 'accounts'],
    queryFn: async () => (await api.get('/telegram-otp/accounts')).data,
    refetchInterval: 60_000,
  });
  const accounts = roster?.data || [];

  const { data: activeRequest } = useQuery({
    queryKey: ['telegram-otp', 'active'],
    queryFn: async () => (await api.get('/telegram-otp/requests/active')).data?.data || null,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (activeRequest?.id) setRequestId((id) => id || activeRequest.id);
  }, [activeRequest]);

  const { data: request } = useQuery({
    queryKey: ['telegram-otp', 'request', requestId],
    queryFn: async () => (await api.get(`/telegram-otp/requests/${requestId}`)).data,
    enabled: !!requestId,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2000 : false),
  });

  const now = useNow(!!request && (request.status === 'pending' || !!request.code));
  const remainingMs = request ? new Date(request.expires_at).getTime() - now : 0;
  const pending = request?.status === 'pending' && remainingMs > 0;
  const showCode = request?.status === 'delivered' && !!request.code && remainingMs > 0;

  useEffect(() => {
    if (request && remainingMs <= 0 && (request.status === 'pending' || request.code)) {
      qc.invalidateQueries({ queryKey: ['telegram-otp', 'request', requestId] });
    }
  }, [request, remainingMs, requestId, qc]);

  const brands = useMemo(
    () => [...new Set(accounts.map((a) => a.brand).filter(Boolean))].sort(),
    [accounts],
  );

  const owners = useMemo(
    () => [...new Set(accounts.map((a) => a.owner).filter(Boolean))].sort(),
    [accounts],
  );

  const statuses = useMemo(
    () => [...new Set(accounts.map((a) => a.status).filter(Boolean))]
      .sort((a, b) => (a.toLowerCase() === 'ready' ? -1 : b.toLowerCase() === 'ready' ? 1 : a.localeCompare(b))),
    [accounts],
  );
  const readyCount = useMemo(() => accounts.filter(isReady).length, [accounts]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/[\s+-]/g, '');
    return accounts
      .filter((a) => pool === 'all' || a.pool === pool)
      .filter((a) => brand === 'all' || a.brand === brand)
      .filter((a) => owner === 'all' || a.owner === owner)
      .filter((a) => status === 'all' || a.status === status)
      .filter((a) => {
        if (!q) return true;
        return [a.id, a.profile, a.owner, a.phone]
          .some((v) => String(v || '').toLowerCase().replace(/[\s+-]/g, '').includes(q));
      });
  }, [accounts, search, pool, brand, owner, status]);

  useEffect(() => {
    setPage(1);
  }, [search, pool, brand, owner, status, pageSize]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, total);
  const pageRows = rows.slice(pageStart - 1, pageEnd);

  function notify(message, tone = 'default') {
    setToastTone(tone);
    setToast(message);
  }

  const requestMut = useMutation({
    mutationFn: (accountId) => api.post('/telegram-otp/requests', { account_id: accountId }).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(['telegram-otp', 'request', data.id], data);
      setRequestId(data.id);
    },
    onError: (err) => notify(err.response?.data?.error || err.message || 'Request failed', 'error'),
  });

  const cancelMut = useMutation({
    mutationFn: (id) => api.post(`/telegram-otp/requests/${id}/cancel`).then((r) => r.data),
    onSettled: () => {
      setRequestId(null);
      qc.removeQueries({ queryKey: ['telegram-otp', 'request'] });
      qc.setQueryData(['telegram-otp', 'active'], null);
    },
  });

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied`);
    } catch {
      notify(`Could not copy ${label.toLowerCase()}`, 'error');
    }
  }

  function closeDialog() {
    if (pending || showCode) {
      cancelMut.mutate(request.id);
      return;
    }
    setRequestId(null);
    qc.setQueryData(['telegram-otp', 'active'], null);
  }

  const account = request?.account;

  return (
    <div>
      <PageHead
        title="Telegram OTP"
        description="Request OTP, then log in to Telegram within 5 minutes — the code appears here."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-ink">{accounts.length}</span>
            <span>accounts ·</span>
            <span className="font-semibold text-ams-success">{readyCount}</span>
            <span>active · synced</span>
            <span className="font-semibold text-ams-ink">{formatAgo(roster?.last_synced_at)}</span>
          </div>
        )}
      />

      <div className="page-filter-bar">
        <div className="page-filter-search !flex-none w-full max-w-xs">
          <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
          <input
            className="input"
            type="search"
            placeholder="Search ID, name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search Telegram accounts"
          />
        </div>
        <label className="page-filter-chip">
          <select className="page-filter-chip-select" value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Filter by type">
            <option value="all">All types</option>
            <option value="gcs">GCS</option>
            <option value="shooter">Shooter</option>
          </select>
        </label>
        <label className="page-filter-chip">
          <select className="page-filter-chip-select" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Filter by brand">
            <option value="all">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        {owners.length > 0 && (
          <label className="page-filter-chip">
            <select className="page-filter-chip-select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter by staff">
              <option value="all">All staff</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        )}
        <label className="page-filter-chip">
          <select className="page-filter-chip-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s.toLowerCase() === 'ready' ? 'Active' : s}</option>)}
          </select>
        </label>
      </div>

      {isLoading && <div className="py-12 text-center text-sm text-ams-muted">Loading Telegram accounts…</div>}

      {isError && (
        <div className="card px-5 py-4 text-sm text-ams-danger">
          Could not load Telegram accounts — {error?.response?.data?.error || error?.message}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="data-panel card overflow-hidden">
          <div className="data-table-wrap">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Phone</th>
                  <th>Brand</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      {accounts.length === 0
                        ? 'No Telegram accounts are assigned to you yet. Ask an admin to set your Telegram shooter owner and GCS brands in User management.'
                        : 'No accounts match this filter.'}
                    </td>
                  </tr>
                ) : pageRows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.profile && a.profile !== a.id ? (
                        <>
                          <div className="text-[13.5px] font-medium text-ams-ink">{a.profile}</div>
                          <div className="font-mono text-[12px] text-ams-faint">{a.id}</div>
                        </>
                      ) : (
                        <div className="font-mono text-[13px] text-ams-ink">{a.id}</div>
                      )}
                    </td>
                    <td className="font-mono text-[13px]">{a.phone || '—'}</td>
                    <td>{a.brand || '—'}</td>
                    <td><PoolBadge account={a} /></td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="col-action">
                      {isReady(a) ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm justify-center"
                          onClick={() => requestMut.mutate(a.id)}
                          disabled={requestMut.isPending}
                        >
                          <KeyRound size={13} strokeWidth={2.25} />
                          Request OTP
                        </button>
                      ) : (
                        <IconTooltip label="The bot has no live session for this account — it cannot receive login codes until it is Active again.">
                          <button type="button" className="btn btn-secondary btn-sm justify-center" disabled>
                            <KeyRound size={13} strokeWidth={2.25} />
                            Request OTP
                          </button>
                        </IconTooltip>
                      )}
                    </td>
                  </tr>
                ))}
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

      <DetailDialog
        open={!!request}
        title={`Telegram OTP · ${account?.id || request?.account_id || ''}`}
        onClose={closeDialog}
        footer={(
          <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog} disabled={cancelMut.isPending}>
            {pending ? 'Cancel request' : 'Close'}
          </button>
        )}
      >
        <div className="drawer-fields">
          {pending && (
            <>
              <p className="text-sm text-ams-muted">
                Log in to Telegram with{' '}
                <strong className="font-mono text-ams-ink">{account?.phone || account?.id}</strong>{' '}
                now. The login code will appear here.
              </p>
              <div className="otp-wait">
                <Loader2 size={18} className="animate-spin" />
                <span>Waiting for the login code…</span>
                <span className="otp-wait__timer">{formatCountdown(remainingMs)}</span>
              </div>
            </>
          )}

          {showCode && (
            <>
              <div className="otp-code-row">
                <span className="otp-code">{request.code}</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(request.code, 'Code')}>
                  <Copy size={13} strokeWidth={2.25} />
                  Copy code
                </button>
              </div>
              {request.has_password && (
                <div className="otp-code-row">
                  <span className="otp-password">••••••••</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(request.password, 'Password')}>
                    <Copy size={13} strokeWidth={2.25} />
                    Copy 2FA password
                  </button>
                </div>
              )}
              <p className="text-[12.5px] text-ams-muted">
                Hidden in {formatCountdown(remainingMs)}. Close this window when you are logged in.
              </p>
            </>
          )}

          {!pending && !showCode && (
            <p className="text-sm text-ams-muted">
              {request?.status === 'cancelled'
                ? 'This request was cancelled.'
                : request?.status === 'delivered'
                  ? 'The code has been hidden. Request a new one if you still need to log in.'
                  : 'No login code arrived within 5 minutes. Request a new one and log in right away.'}
            </p>
          )}
        </div>
      </DetailDialog>

      <Toast open={!!toast} message={toast} tone={toastTone} onClose={() => setToast('')} />
    </div>
  );
}
