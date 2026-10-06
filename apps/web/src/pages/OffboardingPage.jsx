import { useMemo, useState } from 'react';
import { Lock, LockOpen, Search } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import DetailDialog from '../components/DetailDialog';
import IconTooltip from '../components/IconTooltip';
import Toast from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import api from '../lib/api';

const ROLE_LABELS = { admin: 'Admin Master', operator: 'Operator', business: 'Business', reviewer: 'Reviewer' };
const STALE_LOGIN_DAYS = 30;

function siteKeyOf(user) {
  if (['my', 'pp', 'all'].includes(user.site_key)) return user.site_key;
  return user.role === 'admin' ? 'all' : 'my';
}

function formatLastLogin(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isStaleLogin(iso) {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > STALE_LOGIN_DAYS * 86400000;
}

function StatusPill({ active }) {
  return active
    ? <span className="badge badge-success">Active</span>
    : <span className="badge badge-danger">Locked</span>;
}

export default function OffboardingPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('default');

  const isAdmin = profile?.role === 'admin';

  const { data: users = [], isLoading, isError, error } = useQuery({
    queryKey: ['users', 'offboarding'],
    queryFn: async () => {
      const { data } = await api.get('/users/offboarding');
      return data?.data || [];
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => statusFilter === 'all' || (statusFilter === 'active' ? u.is_active : !u.is_active))
      .filter((u) => !q || u.username?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q))
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  }, [users, search, statusFilter]);

  const lockedCount = users.filter((u) => !u.is_active).length;
  const locking = target?.is_active === true;

  const mutation = useMutation({
    mutationFn: ({ id, lock, why }) => api.post(`/users/${id}/${lock ? 'lock' : 'unlock'}`, { reason: why }).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setToastTone('default');
      setToast(vars.lock ? `${target?.full_name} locked — signed out everywhere` : `${target?.full_name} unlocked`);
      closeDialog();
    },
    onError: (err) => {
      setToastTone('error');
      setToast(err.response?.data?.error || err.message || 'Action failed');
    },
  });

  function openDialog(user) {
    setTarget(user);
    setReason('');
  }

  function closeDialog() {
    setTarget(null);
    setReason('');
  }

  function submit(e) {
    e.preventDefault();
    if (!target || reason.trim().length < 3) return;
    mutation.mutate({ id: target.id, lock: locking, why: reason.trim() });
  }

  return (
    <div>
      <PageHead
        title="Staff offboarding"
        description="Lock the AMS account of anyone who has left as soon as the Offboarding request arrives. Locking signs them out everywhere immediately. Every lock and unlock is recorded in the Audit Log with your reason."
        actions={(
          <div className="flex items-center gap-2 text-[12.5px] text-ams-muted">
            <span className="font-semibold text-ams-ink">{users.length - lockedCount}</span>
            <span>active</span>
            <span className="text-ams-faint">·</span>
            <span className="font-semibold text-ams-ink">{lockedCount}</span>
            <span>locked</span>
          </div>
        )}
      />

      <div className="page-filter-bar">
        <div className="page-filter-search !flex-none w-full max-w-xs">
          <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
          <input
            className="input"
            type="search"
            placeholder="Search name or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search staff"
          />
        </div>
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="active">Active</option>
            <option value="locked">Locked</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {isLoading && <div className="py-12 text-center text-sm text-ams-muted">Loading staff…</div>}

      {isError && (
        <div className="card px-5 py-4 text-sm text-ams-danger">
          Could not load staff — {error?.response?.data?.error || error?.message}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="data-panel card overflow-hidden">
          <div className="data-table-wrap">
            <table className="data-table data-table--offboard w-full">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Site</th>
                  <th>Role</th>
                  <th>Last login</th>
                  <th>Status</th>
                  <th className="col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">No staff match this filter.</td>
                  </tr>
                ) : rows.map((u) => {
                  const isSelf = u.id === profile?.id;
                  const adminTarget = u.role === 'admin' && !isAdmin;
                  const blockedReason = isSelf
                    ? 'You cannot lock your own account'
                    : adminTarget ? 'Admin accounts can only be locked by an admin' : null;
                  const stale = u.is_active && isStaleLogin(u.last_sign_in_at);
                  return (
                    <tr key={u.id} className={u.is_active ? undefined : 'is-locked'}>
                      <td>
                        <div className="font-medium text-ams-ink">{u.full_name}</div>
                        <div className="font-mono text-[12px] text-ams-faint">{u.username}</div>
                      </td>
                      <td>
                        <span className={getSiteChipClass(siteKeyOf(u))}>{SITES[siteKeyOf(u)].short}</span>
                      </td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge-accent' : 'badge-default'}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">
                        {formatLastLogin(u.last_sign_in_at) ? (
                          <IconTooltip label={stale ? `No login for over ${STALE_LOGIN_DAYS} days — check if still on staff` : 'Last successful login'}>
                            <span className={stale ? 'offboard-stale' : 'text-ams-muted'}>{formatLastLogin(u.last_sign_in_at)}</span>
                          </IconTooltip>
                        ) : (
                          <span className={u.is_active ? 'offboard-stale' : 'text-ams-faint'}>Never</span>
                        )}
                      </td>
                      <td><StatusPill active={u.is_active} /></td>
                      <td className="col-action">
                        {blockedReason ? (
                          <IconTooltip label={blockedReason}>
                            <span className="text-[12px] text-ams-faint">{isSelf ? 'You' : 'Admin only'}</span>
                          </IconTooltip>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm min-w-[5.5rem] justify-center"
                            onClick={() => openDialog(u)}
                            disabled={mutation.isPending}
                          >
                            {u.is_active ? <Lock size={13} strokeWidth={2.25} /> : <LockOpen size={13} strokeWidth={2.25} />}
                            {u.is_active ? 'Lock' : 'Unlock'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DetailDialog
        open={!!target}
        title={`${locking ? 'Lock' : 'Unlock'} account · ${target?.username || ''}`}
        onClose={() => !mutation.isPending && closeDialog()}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog} disabled={mutation.isPending}>
              Cancel
            </button>
            <button
              type="submit"
              form="offboard-form"
              className={`btn btn-sm ${locking ? 'btn-danger' : 'btn-primary'}`}
              disabled={mutation.isPending || reason.trim().length < 3}
            >
              {mutation.isPending ? 'Saving…' : locking ? 'Lock account' : 'Unlock account'}
            </button>
          </>
        )}
      >
        <form id="offboard-form" onSubmit={submit} className="drawer-fields">
          <p className="text-sm text-ams-muted">
            {locking ? (
              <>
                <strong className="text-ams-ink">{target?.full_name}</strong> will be signed out on every device and
                cannot log in until an admin or the resource team unlocks the account.
              </>
            ) : (
              <>
                <strong className="text-ams-ink">{target?.full_name}</strong> will be able to log in again. Only unlock
                when the person is confirmed back on staff.
              </>
            )}
          </p>
          <label className="drawer-field">
            <span className="drawer-label">Reason (required)</span>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={locking ? 'e.g. Offboarding request — resigned 6 Oct' : 'e.g. Rehired — HR confirmation 7 Oct'}
              maxLength={200}
              autoFocus
              required
            />
          </label>
        </form>
      </DetailDialog>

      <Toast open={!!toast} message={toast} tone={toastTone} onClose={() => setToast('')} />
    </div>
  );
}
