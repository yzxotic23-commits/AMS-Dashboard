import { useState } from 'react';
import { Lock, LockOpen, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageHead from '../../components/PageHead';
import DetailDialog from '../../components/DetailDialog';
import IconTooltip from '../../components/IconTooltip';
import Toast from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { SITES, getSiteChipClass } from '../../lib/sites';
import { BRAND_OPTIONS, normalizeBrands } from '../../lib/profile-brands';
import api from '../../lib/api';

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

const EMPTY_FORM = {
  username: '',
  full_name: '',
  password: '',
  role: 'operator',
  site_key: 'my',
  brands: [],
};

function userToForm(user) {
  return {
    username: user?.username || '',
    full_name: user?.full_name || '',
    password: '',
    role: user?.role || 'operator',
    site_key: user?.site_key || 'my',
    brands: normalizeBrands(user?.brands),
  };
}

export default function UserManagementPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [deleteUser, setDeleteUser] = useState(null);
  const [toast, setToast] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

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

  const createMut = useMutation({
    mutationFn: (body) => api.post('/users', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      closeDialog();
      setToast('User account created');
    },
    onError: (err) => setToast(err.response?.data?.error || err.message || 'Create failed'),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/users/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      closeDialog();
      setToast('User updated');
    },
    onError: (err) => setToast(err.response?.data?.error || err.message || 'Update failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setDeleteUser(null);
      setToast('User deleted');
    },
    onError: (err) => setToast(err.message || 'Delete failed'),
  });

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
      setToast('Business users need at least one brand');
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

  const formSiteOptions = siteOptionsForRole();
  const dialogBusy = createMut.isPending || patchMut.isPending;

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ams-faint">Settings</p>
      <PageHead
        title="User management"
        description="Admin Master manages users and settings only — not pipeline operators. Operators register accounts (Owner) and can assign Staff names for Business. Business users only see Delivery tickets and Governance for their brands."
        actions={(
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <UserPlus size={15} strokeWidth={2.25} />
            Add user
          </button>
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
        <div className="card overflow-hidden">
          <table className="data-table data-table--users w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Site</th>
                <th>Role</th>
                <th>Brands</th>
                <th className="col-action">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === profile?.id;
                return (
                  <tr key={u.id}>
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
                    <td className="col-action">
                      <div className="col-action-btns">
                        <IconTooltip label={u.is_active ? 'Lock account' : 'Unlock account'}>
                          <button
                            type="button"
                            className={`table-icon-btn${u.is_active ? '' : ' text-ams-danger'}`}
                            disabled={isSelf || patchMut.isPending}
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
                              disabled={deleteMut.isPending}
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
          {users.length === 0 && (
            <div className="empty-hint">No users yet. Add Operator accounts for Control Center pipeline, or other roles as needed.</div>
          )}
        </div>
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
                ? 'Delivery ticket Standby list is limited to these brands.'
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

      <Toast message={toast} onClear={() => setToast('')} />
    </div>
  );
}
