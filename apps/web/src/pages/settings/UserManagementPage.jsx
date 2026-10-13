import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Lock, LockOpen, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageHead from '../../components/PageHead';
import DetailDialog from '../../components/DetailDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import IconTooltip from '../../components/IconTooltip';
import Toast from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { SITES, getSiteChipClass } from '../../lib/sites';
import { BRAND_OPTIONS, normalizeBrands } from '../../lib/profile-brands';
import api from '../../lib/api';
import { downloadFromApi } from '../../lib/download';

const ROLES = [
  { value: 'operator', label: 'Operator' },
  { value: 'business', label: 'Business' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'admin', label: 'Admin Master' },
];

const SITE_OPTIONS = [
  { value: 'all', label: `${SITES.all.name} (All)` },
  { value: 'my', label: `${SITES.my.name} (MY)` },
  { value: 'pp', label: `${SITES.pp.name} (PP)` },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];

function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label || role;
}

function siteOptionsForRole() {
  return SITE_OPTIONS;
}

function resolveSiteKey(siteKey, role) {
  if (siteKey === 'my' || siteKey === 'pp' || siteKey === 'all') return siteKey;
  return role === 'admin' ? 'all' : 'my';
}

function siteShortLabel(siteKey, role) {
  return SITES[resolveSiteKey(siteKey, role)].short;
}

const STALE_LOGIN_DAYS = 30;

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

const EMPTY_FORM = {
  username: '',
  full_name: '',
  password: '',
  role: 'operator',
  site_key: 'my',
  brands: [],
  can_offboard: false,
  in_operator_roster: false,
};

function userToForm(user) {
  return {
    username: user?.username || '',
    full_name: user?.full_name || '',
    password: '',
    role: user?.role || 'operator',
    site_key: user?.site_key || 'my',
    brands: normalizeBrands(user?.brands),
    can_offboard: Boolean(user?.can_offboard),
    in_operator_roster: Boolean(user?.in_operator_roster),
  };
}

export default function UserManagementPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [deleteUser, setDeleteUser] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('default');
  const [form, setForm] = useState(EMPTY_FORM);
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const isAdmin = profile?.role === 'admin';
  const isEdit = Boolean(editUser);
  const dialogOpen = createOpen || isEdit;
  const brandsEditable = form.role === 'business';

  const { data: users = [], isLoading, isError, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/users');
      return data?.data || [];
    },
    enabled: isAdmin,
  });

  const showToast = useCallback((message, tone = 'default') => {
    setToastTone(tone);
    setToast(message);
  }, []);

  const createMut = useMutation({
    mutationFn: (body) => api.post('/users', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      closeDialog();
      showToast('User account created');
    },
    onError: (err) => showToast(err.response?.data?.error || err.message || 'Create failed', 'error'),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/users/${id}`, body).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      if (vars?.body && Object.keys(vars.body).length === 1 && 'is_active' in vars.body) {
        showToast(vars.body.is_active ? 'Account unlocked' : 'Account locked — signed out everywhere');
        return;
      }
      closeDialog();
      showToast('User updated');
    },
    onError: (err) => showToast(err.response?.data?.error || err.message || 'Update failed', 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setDeleteUser(null);
      showToast('User deleted');
    },
    onError: (err) => showToast(err.response?.data?.error || err.message || 'Delete failed', 'error'),
  });

  const total = users.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = total ? (safePage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(safePage * pageSize, total);
  const pageRows = useMemo(
    () => users.slice((safePage - 1) * pageSize, safePage * pageSize),
    [users, safePage, pageSize],
  );

  const pageSelectableIds = useMemo(
    () => pageRows.filter((u) => u.id !== profile?.id).map((u) => u.id),
    [pageRows, profile?.id],
  );
  const allSelectableIds = useMemo(
    () => users.filter((u) => u.id !== profile?.id).map((u) => u.id),
    [users, profile?.id],
  );
  const allPageSelected = pageSelectableIds.length > 0
    && pageSelectableIds.every((id) => selected.has(id));
  const somePageSelected = pageSelectableIds.some((id) => selected.has(id));
  const selectedUsers = useMemo(
    () => users.filter((u) => selected.has(u.id)),
    [users, selected],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(allSelectableIds);
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allSelectableIds]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [pageSize]);

  const toggleSelect = useCallback((id, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectPage = useCallback((on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      pageSelectableIds.forEach((id) => {
        if (on) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }, [pageSelectableIds]);

  function closeDialog() {
    setCreateOpen(false);
    setEditUser(null);
    setForm(EMPTY_FORM);
  }

  function openCreate() {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(user) {
    setCreateOpen(false);
    setEditUser(user);
    setForm(userToForm(user));
  }

  function toggleBrand(brand) {
    setForm((f) => {
      const set = new Set(f.brands);
      if (set.has(brand)) set.delete(brand);
      else set.add(brand);
      return { ...f, brands: BRAND_OPTIONS.filter((b) => set.has(b)) };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.role === 'business' && form.brands.length === 0) {
      showToast('Business users need at least one brand', 'error');
      return;
    }
    const body = {
      full_name: form.full_name,
      role: form.role,
      site_key: form.site_key,
      brands: form.role === 'business' ? form.brands : [],
    };
    if (form.password.trim()) body.password = form.password;

    if (isEdit) {
      if (form.role !== 'admin' && form.can_offboard !== Boolean(editUser.can_offboard)) {
        body.can_offboard = form.can_offboard;
      }
      if (form.role === 'admin' && form.in_operator_roster !== Boolean(editUser.in_operator_roster)) {
        body.in_operator_roster = form.in_operator_roster;
      }
      await patchMut.mutateAsync({ id: editUser.id, body });
      return;
    }

    await createMut.mutateAsync({
      ...body,
      username: form.username.trim().toLowerCase(),
      password: form.password,
    });
  }

  function handleRoleChange(role) {
    setForm((f) => {
      const next = { ...f, role };
      if (role === 'admin') next.site_key = 'all';
      if (role !== 'business') next.brands = [];
      return next;
    });
  }

  async function bulkSetActive(isActive) {
    if (selectedUsers.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const u of selectedUsers) {
      try {
        await api.patch(`/users/${u.id}`, { is_active: isActive });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    qc.invalidateQueries({ queryKey: ['users'] });
    setBulkBusy(false);
    if (fail) {
      showToast(`${ok} updated, ${fail} failed`, 'error');
    } else {
      showToast(isActive ? `Unlocked ${ok} user${ok === 1 ? '' : 's'}` : `Locked ${ok} user${ok === 1 ? '' : 's'}`);
    }
  }

  async function confirmBulkDelete() {
    if (selectedUsers.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const u of selectedUsers) {
      try {
        await api.delete(`/users/${u.id}`);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    qc.invalidateQueries({ queryKey: ['users'] });
    setSelected(new Set());
    setBulkDeleteOpen(false);
    setBulkBusy(false);
    if (fail) {
      showToast(`${ok} deleted, ${fail} failed`, 'error');
    } else {
      showToast(`Deleted ${ok} user${ok === 1 ? '' : 's'}`);
    }
  }

  const [exporting, setExporting] = useState(false);

  async function exportUsers() {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadFromApi('/users/export', `ams-users-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast('User list exported');
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  const formSiteOptions = siteOptionsForRole();
  const dialogBusy = createMut.isPending || patchMut.isPending;

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ams-faint">Settings</p>
      <PageHead
        title="User management"
        description="Admin Master manages users and settings only — not pipeline operators. Operators register accounts (Owner) and can assign Staff names for Business. Business users only see Delivery tickets and Governance for their brands."
        actions={(
          <>
            {profile?.can_export && (
              <IconTooltip label="Staff list with last login — for the monthly check against active staff">
                <button type="button" className="btn btn-secondary btn-sm" onClick={exportUsers} disabled={exporting}>
                  <Download size={15} strokeWidth={2.25} />
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
              </IconTooltip>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
              <UserPlus size={15} strokeWidth={2.25} />
              Add user
            </button>
          </>
        )}
      />

      {isLoading && (
        <div className="py-12 text-center text-sm text-ams-muted">Loading users…</div>
      )}

      {isError && (
        <div className="card px-5 py-4 text-sm text-ams-danger">
          Could not load users — {error?.message || 'check that you are signed in as admin.'}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="ip-bulkbar mb-3">
            <div className="ip-bulkbar-start">
              <label className="ip-bulkbar-check">
                <input
                  type="checkbox"
                  className="ams-check"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = somePageSelected && !allPageSelected;
                  }}
                  onChange={(e) => toggleSelectPage(e.target.checked)}
                  disabled={pageSelectableIds.length === 0}
                />
                Select page
              </label>
              <span
                className={`ip-bulkbar-meta${selected.size > 0 ? ' is-visible' : ''}`}
                aria-hidden={selected.size === 0}
              >
                <span className="ip-bulkbar-count">{selected.size}</span>
                selected
              </span>
              <div
                className={`ip-bulkbar-actions${selected.size > 0 ? ' is-visible' : ''}`}
                aria-hidden={selected.size === 0}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={bulkBusy}
                  onClick={() => bulkSetActive(true)}
                  tabIndex={selected.size > 0 ? 0 : -1}
                >
                  Unlock
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={bulkBusy}
                  onClick={() => bulkSetActive(false)}
                  tabIndex={selected.size > 0 ? 0 : -1}
                >
                  Lock
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={bulkBusy}
                  onClick={() => setBulkDeleteOpen(true)}
                  tabIndex={selected.size > 0 ? 0 : -1}
                >
                  Bulk Delete
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(new Set())}
                  tabIndex={selected.size > 0 ? 0 : -1}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="data-panel card overflow-hidden">
            <div className="data-table-wrap">
              <table className="data-table data-table--users w-full">
                <thead>
                  <tr>
                    <th className="col-check">
                      <input
                        type="checkbox"
                        className="ams-check"
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = somePageSelected && !allPageSelected;
                        }}
                        onChange={(e) => toggleSelectPage(e.target.checked)}
                        disabled={pageSelectableIds.length === 0}
                        aria-label="Select page"
                      />
                    </th>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Site</th>
                    <th>Role</th>
                    <th>Brands</th>
                    <th>Last login</th>
                    <th className="col-action">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty-cell">
                        No users yet. Add Operator accounts for Control Center pipeline, or other roles as needed.
                      </td>
                    </tr>
                  ) : pageRows.map((u) => {
                    const isSelf = u.id === profile?.id;
                    const canSelect = !isSelf;
                    return (
                      <tr key={u.id}>
                        <td className="col-check">
                          <input
                            type="checkbox"
                            className="ams-check"
                            checked={selected.has(u.id)}
                            disabled={!canSelect}
                            aria-label={`Select ${u.username}`}
                            onChange={(e) => toggleSelect(u.id, e.target.checked)}
                          />
                        </td>
                        <td className="font-medium">{u.full_name}</td>
                        <td className="font-mono text-sm">{u.username}</td>
                        <td>
                          <span className={getSiteChipClass(resolveSiteKey(u.site_key, u.role))}>
                            {siteShortLabel(u.site_key, u.role)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${u.role === 'admin' ? 'badge-accent' : 'badge-default'}`}>
                            {roleLabel(u.role)}
                          </span>
                          {u.can_offboard && u.role !== 'admin' && (
                            <IconTooltip label="Can lock/unlock staff accounts (Staff offboarding)">
                              <span className="badge badge-warn ml-1">Offboarding</span>
                            </IconTooltip>
                          )}
                          {u.in_operator_roster && u.role === 'admin' && (
                            <IconTooltip label="Listed as an Owner in Register and per-operator counts">
                              <span className="badge badge-default ml-1">Operator</span>
                            </IconTooltip>
                          )}
                        </td>
                        <td>
                          {u.role === 'business' ? (
                            <span className="flex flex-wrap gap-1">
                              {normalizeBrands(u.brands).length ? normalizeBrands(u.brands).map((b) => (
                                <span key={b} className="badge badge-accent">{b}</span>
                              )) : (
                                <span className="text-[12.5px] text-ams-faint">None</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[12.5px] text-ams-faint">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-[12.5px]">
                          {formatLastLogin(u.last_sign_in_at) ? (
                            <IconTooltip label={isStaleLogin(u.last_sign_in_at) && u.is_active ? `No login for over ${STALE_LOGIN_DAYS} days — check if still on staff` : 'Last successful login'}>
                              <span className={isStaleLogin(u.last_sign_in_at) && u.is_active ? 'text-ams-warn' : 'text-ams-muted'}>
                                {formatLastLogin(u.last_sign_in_at)}
                              </span>
                            </IconTooltip>
                          ) : (
                            <span className="text-ams-faint">Never</span>
                          )}
                          {!u.is_active && <span className="badge badge-danger ml-2">Locked</span>}
                        </td>
                        <td className="col-action">
                          <div className="col-action-btns">
                            <IconTooltip label={u.is_active ? 'Lock account' : 'Unlock account'}>
                              <button
                                type="button"
                                className={`table-icon-btn${u.is_active ? '' : ' text-ams-danger'}`}
                                disabled={isSelf || patchMut.isPending || bulkBusy}
                                aria-label={u.is_active ? 'Lock account' : 'Unlock account'}
                                onClick={() => patchMut.mutate({
                                  id: u.id,
                                  body: { is_active: !u.is_active },
                                })}
                              >
                                {u.is_active ? <LockOpen size={15} strokeWidth={2} /> : <Lock size={15} strokeWidth={2} />}
                              </button>
                            </IconTooltip>
                            <IconTooltip label="Edit user">
                              <button
                                type="button"
                                className="table-icon-btn"
                                disabled={dialogBusy}
                                aria-label="Edit user"
                                onClick={() => openEdit(u)}
                              >
                                <Pencil size={15} strokeWidth={2} />
                              </button>
                            </IconTooltip>
                            {!isSelf && (
                              <IconTooltip label="Delete user">
                                <button
                                  type="button"
                                  className="table-icon-btn table-icon-btn--danger"
                                  disabled={deleteMut.isPending || bulkBusy}
                                  aria-label="Delete user"
                                  onClick={() => setDeleteUser(u)}
                                >
                                  <Trash2 size={15} strokeWidth={2} />
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
                    {PAGE_SIZE_OPTIONS.map((n) => (
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
          </div>
        </>
      )}

      <DetailDialog
        open={dialogOpen}
        title={isEdit ? `Edit user · ${editUser?.username}` : 'Add user'}
        onClose={closeDialog}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="submit"
              form="user-form"
              className="btn btn-primary btn-sm"
              disabled={dialogBusy}
            >
              <Plus size={15} strokeWidth={2.25} />
              {dialogBusy ? 'Saving…' : isEdit ? 'Save changes' : 'Create account'}
            </button>
          </>
        )}
      >
        <form id="user-form" onSubmit={handleSubmit} className="drawer-fields">
          <label className="drawer-field">
            <span className="drawer-label">Full name</span>
            <input
              className="input"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Username (login)</span>
            <input
              className="input font-mono"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              pattern="[a-zA-Z0-9._-]{3,32}"
              disabled={isEdit}
              required={!isEdit}
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Site</span>
            <select
              className="input"
              value={form.site_key}
              onChange={(e) => setForm((f) => ({ ...f, site_key: e.target.value }))}
            >
              {formSiteOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Role</span>
            <select
              className="input"
              value={form.role}
              onChange={(e) => handleRoleChange(e.target.value)}
              disabled={isEdit && editUser?.id === profile?.id}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <fieldset className="drawer-field">
            <legend className="drawer-label">
              Brands{brandsEditable ? ' (required)' : ''}
            </legend>
            <p className="drawer-hint" style={{ marginTop: 0 }}>
              {brandsEditable
                ? 'Standby list is limited to these brands, and only accounts whose Staff name matches this user’s Full name.'
                : 'Switch Role to Business to assign brands. Other roles see all brands.'}
            </p>
            <div className="flex flex-wrap gap-2" style={{ marginTop: 8, opacity: brandsEditable ? 1 : 0.45 }}>
              {BRAND_OPTIONS.map((brand) => {
                const checked = form.brands.includes(brand);
                return (
                  <label
                    key={brand}
                    className={`badge ${checked && brandsEditable ? 'badge-accent' : 'badge-default'}`}
                    style={{ cursor: brandsEditable ? 'pointer' : 'not-allowed', userSelect: 'none' }}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      disabled={!brandsEditable}
                      onChange={() => toggleBrand(brand)}
                    />
                    {brand}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {isEdit && form.role !== 'admin' && form.role !== 'business' && (
            <label className="drawer-field flex items-start gap-2" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="ams-check mt-0.5"
                checked={form.can_offboard}
                onChange={(e) => setForm((f) => ({ ...f, can_offboard: e.target.checked }))}
              />
              <span>
                <span className="drawer-label">Offboarding access</span>
                <span className="drawer-hint block" style={{ marginTop: 2 }}>
                  Can lock / unlock non-admin staff accounts from Staff offboarding (reason required, audited).
                </span>
              </span>
            </label>
          )}
          {isEdit && form.role === 'admin' && (
            <label className="drawer-field flex items-start gap-2" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="ams-check mt-0.5"
                checked={form.in_operator_roster}
                onChange={(e) => setForm((f) => ({ ...f, in_operator_roster: e.target.checked }))}
              />
              <span>
                <span className="drawer-label">Also works as operator</span>
                <span className="drawer-hint block" style={{ marginTop: 2 }}>
                  Shows this admin as an Owner in Register Account and in per-operator counts.
                </span>
              </span>
            </label>
          )}
          <label className="drawer-field">
            <span className="drawer-label">
              {isEdit ? 'New password (optional)' : 'Password'}
            </span>
            <input
              type="text"
              className="input font-mono"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              minLength={isEdit ? undefined : 8}
              required={!isEdit}
              placeholder={isEdit ? 'Leave blank to keep current' : ''}
            />
          </label>
        </form>
      </DetailDialog>

      <DetailDialog
        open={!!deleteUser}
        title={`Delete user · ${deleteUser?.username || ''}`}
        onClose={() => setDeleteUser(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteUser(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleteUser.id)}
            >
              Delete user
            </button>
          </>
        )}
      >
        <p className="text-sm text-ams-muted">
          Permanently delete <strong className="text-ams-ink">{deleteUser?.full_name}</strong>?
          This cannot be undone.
        </p>
      </DetailDialog>

      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Delete selected users?"
        message={`Permanently delete ${selectedUsers.length} selected user${selectedUsers.length === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel={bulkBusy ? 'Deleting…' : 'Delete'}
        danger
        onConfirm={confirmBulkDelete}
        onCancel={() => !bulkBusy && setBulkDeleteOpen(false)}
      />

      <Toast
        open={!!toast}
        message={toast}
        tone={toastTone}
        onClose={() => setToast('')}
      />
    </div>
  );
}
