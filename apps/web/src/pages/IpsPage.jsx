import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, FileSpreadsheet, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import ConfirmDialog from '../components/ConfirmDialog';
import Drawer from '../components/Drawer';
import IconTooltip from '../components/IconTooltip';
import Toast from '../components/Toast';
import api from '../lib/api';
import { mapIpRow } from '../lib/resource-mappers';
import { toastCopy } from '../lib/operator-copy';
import { downloadIpImportTemplate, parseIpCsvPreview } from '../lib/ip-import';

function riskTone(count) {
  if (count >= 8) return 'text-ams-danger';
  if (count >= 4) return 'text-ams-warn';
  return 'text-ams-success';
}

function ActiveToggle({ active, onChange }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2"
      onClick={() => onChange(!active)}
    >
      <span className={`toggle-track ${active ? 'toggle-on' : ''}`}>
        <span className="toggle-thumb" />
      </span>
      <span className={`text-xs font-semibold ${active ? 'text-ams-success' : 'text-ams-faint'}`}>
        {active ? 'Active' : 'Inactive'}
      </span>
    </button>
  );
}

function mapRow(row) {
  return mapIpRow(row);
}

export default function IpsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [shownPw, setShownPw] = useState({});
  const [drawer, setDrawer] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    ip_address: '',
    port: '',
    username: '',
    password: '',
    proxy_provider: '',
    status: 'ACTIVE',
  });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toast, setToast] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const importInputRef = useRef(null);

  const searchQuery = search.trim();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['ips', page, pageSize, searchQuery, statusFilter],
    queryFn: async () => {
      const params = { page, limit: pageSize };
      if (searchQuery) params.search = searchQuery;
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await api.get('/ips', { params });
      return {
        rows: (res.data?.data || []).map(mapRow),
        total: res.data?.pagination?.total ?? 0,
      };
    },
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, total);

  const { data: activeTotal = 0 } = useQuery({
    queryKey: ['ips', 'stats', 'active'],
    queryFn: async () => {
      const res = await api.get('/ips', { params: { limit: 1, status: 'ACTIVE' } });
      return res.data?.pagination?.total ?? 0;
    },
  });

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize, statusFilter]);

  useEffect(() => {
    if (!data) return;
    if (page > totalPages) setPage(totalPages);
  }, [data, page, totalPages]);

  useEffect(() => {
    setSelected(new Set());
  }, [page, pageSize, searchQuery, statusFilter]);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 500 } });
      return res.data?.data || [];
    },
  });

  const ipBindings = useMemo(() => {
    const map = {};
    accounts.forEach((a) => {
      if (!a.ip_id) return;
      if (!map[a.ip_id]) map[a.ip_id] = [];
      map[a.ip_id].push(a.account_name || a.account_name);
    });
    return map;
  }, [accounts]);

  const ipDevices = useMemo(() => {
    const map = {};
    accounts.forEach((a) => {
      if (!a.ip_id) return;
      const dev = a.devices?.device_name || '';
      if (dev) map[a.ip_id] = map[a.ip_id] || dev;
    });
    return map;
  }, [accounts]);

  const patchMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/ips/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ips'] }),
  });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/ips', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ips'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/ips/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ips'] }),
  });

  const importMut = useMutation({
    mutationFn: (csv) => api.post('/ips/import', { csv, skipDuplicates: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ips'] }),
  });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  function updateRow(id, patch) {
    const body = {};
    if ('active' in patch) body.status = patch.active ? 'ACTIVE' : 'INACTIVE';
    if ('status' in patch) body.status = patch.status;
    patchMut.mutate({ id, body });
  }

  function openCreate() {
    setCreateForm({
      ip_address: '',
      port: '',
      username: '',
      password: '',
      proxy_provider: '',
      status: 'ACTIVE',
    });
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
  }

  function openImport() {
    setImportCsv('');
    setImportFileName('');
    setImportPreview(null);
    setImportOpen(true);
  }

  function closeImport() {
    setImportOpen(false);
    setImportCsv('');
    setImportFileName('');
    setImportPreview(null);
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      setImportCsv(text);
      setImportFileName(file.name);
      setImportPreview(parseIpCsvPreview(text));
    } catch {
      showToast('Could not read CSV file');
      setImportCsv('');
      setImportFileName('');
      setImportPreview(null);
    }
  }

  function runImport() {
    if (!importCsv.trim()) {
      showToast('Choose a CSV file first');
      return;
    }
    if (!importPreview?.validCount) {
      showToast('No valid rows to import');
      return;
    }

    importMut.mutate(importCsv, {
      onSuccess: (res) => {
        const { imported = 0, skipped = [], errors = [] } = res.data || {};
        showToast(toastCopy.ipImported(imported, skipped.length, errors.length));
        closeImport();
        setPage(1);
      },
      onError: (e) => {
        showToast(e.response?.data?.error || e.message || 'Import failed');
      },
    });
  }

  function saveCreate() {
    const body = {
      ip_address: createForm.ip_address.trim(),
      port: createForm.port.trim() || null,
      username: createForm.username.trim() || null,
      password: createForm.password || null,
      proxy_provider: createForm.proxy_provider.trim() || null,
      status: createForm.status,
    };
    if (!body.ip_address) {
      showToast('IP address is required');
      return;
    }
    createMut.mutate(body, {
      onSuccess: () => {
        showToast(toastCopy.ipCreated(body.ip_address));
        closeCreate();
      },
      onError: (e) => {
        showToast(e.response?.data?.error || e.message || 'Failed to add IP');
      },
    });
  }

  function openEdit(row) {
    setDrawer(row);
    setEditForm({
      ip_address: row.ip_address || '',
      port: row.port || '',
      username: row.username || '',
      password: row.password || '',
      status: row.status || 'ACTIVE',
    });
  }

  function closeEdit() {
    setDrawer(null);
    setEditForm(null);
  }

  function saveEdit() {
    if (!drawer || !editForm) return;
    const patch = {
      ip_address: editForm.ip_address.trim(),
      port: editForm.port.trim(),
      username: editForm.username.trim(),
      password: editForm.password,
      status: editForm.status,
      active: editForm.status === 'ACTIVE',
    };
    if (!patch.ip_address) {
      showToast('IP address is required');
      return;
    }
    patchMut.mutate(
      {
        id: drawer.id,
        body: {
          ip_address: patch.ip_address,
          port: patch.port,
          username: patch.username,
          password: patch.password,
          status: patch.status,
        },
      },
      {
        onSuccess: () => {
          showToast(toastCopy.ipSaved());
          closeEdit();
        },
      },
    );
  }

  function executeDelete(ids) {
    ids.forEach((id) => deleteMut.mutate(id));
    setSelected(new Set());
  }

  function requestDeleteRow(id) {
    const row = rows.find((r) => r.id === id);
    if (row?.in_use > 0) {
      showToast(toastCopy.ipInUse());
      return;
    }
    setDeleteConfirm({
      ids: [id],
      title: 'Delete IP?',
      message: `Are you sure you want to delete ${row.ip_address}? This cannot be undone.`,
    });
  }

  function requestBulkDelete() {
    if (selected.size === 0) {
      showToast(toastCopy.ipSelectFirst());
      return;
    }
    const ids = [...selected].filter((id) => !(rows.find((r) => r.id === id)?.in_use > 0));
    const blocked = selected.size - ids.length;
    if (ids.length === 0) {
      showToast(toastCopy.ipInUse());
      return;
    }
    const label = ids.length === 1
      ? rows.find((r) => r.id === ids[0])?.ip_address
      : `${ids.length} IPs`;
    setDeleteConfirm({
      ids,
      blocked,
      title: ids.length === 1 ? 'Delete IP?' : `Delete ${ids.length} IPs?`,
      message: blocked > 0
        ? `Delete ${label}? ${blocked} in-use IP(s) will be skipped. This cannot be undone.`
        : `Are you sure you want to delete ${label}? This cannot be undone.`,
    });
  }

  function confirmDelete() {
    if (!deleteConfirm) return;
    const { ids, blocked = 0 } = deleteConfirm;
    executeDelete(ids);
    setDeleteConfirm(null);
    if (ids.length === 1 && blocked === 0) {
      showToast(toastCopy.ipDeleted());
    } else {
      showToast(toastCopy.ipBulkDelete(ids.length, blocked));
    }
  }

  function deleteRow(id) {
    requestDeleteRow(id);
  }

  function bulkActive(active) {
    if (selected.size === 0) {
      showToast(toastCopy.ipSelectFirst());
      return;
    }
    selected.forEach((id) => updateRow(id, { active, status: active ? 'ACTIVE' : 'INACTIVE' }));
    showToast(active ? toastCopy.ipSetActive(selected.size) : toastCopy.ipSetInactive(selected.size));
  }

  function bulkDelete() {
    requestBulkDelete();
  }

  function toggleAll(on) {
    setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());
  }

  const activeCount = activeTotal;

  return (
    <div>
      <PageHead
        title="IP Ledger"
        description="Procured IPs are entered here. Active status is maintained by procurement; risk count and in-use status sync from the system. Per SOP, each IP supports up to 2 accounts."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-ink">{total}</span>
            <span>IPs ·</span>
            <span className="font-semibold text-ams-success">{activeCount}</span>
            <span>active</span>
          </div>
        )}
      />

      <div className="ip-bulkbar mb-3">
        <div className="ip-bulkbar-start">
          <label className="ip-bulkbar-check">
            <input
              type="checkbox"
              className="ams-check"
              checked={allSelected}
              onChange={(e) => toggleAll(e.target.checked)}
            />
            Select all
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
              onClick={() => bulkActive(true)}
              tabIndex={selected.size > 0 ? 0 : -1}
            >
              Set Active
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => bulkActive(false)}
              tabIndex={selected.size > 0 ? 0 : -1}
            >
              Set Inactive
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={bulkDelete}
              tabIndex={selected.size > 0 ? 0 : -1}
            >
              Bulk Delete
            </button>
          </div>
        </div>
        <div className="ip-bulkbar-end">
          <div className="ip-bulkbar-search">
            <Search size={15} className="ip-bulkbar-search-icon" strokeWidth={2} />
            <input
              className="input ip-bulkbar-search-input"
              type="search"
              placeholder="Search IP, provider…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search IP ledger"
            />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={openImport}>
            <Upload size={15} strokeWidth={2} />
            Import
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={15} strokeWidth={2} />
            Add IP
          </button>
        </div>
      </div>

      <div className="data-panel card overflow-hidden">
        {isLoading && !data ? (
          <p className="p-8 text-center text-sm text-ams-faint">Loading…</p>
        ) : (
          <div className={`data-table-wrap${isFetching ? ' opacity-70' : ''}`}>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-check" aria-label="Select" />
                  <th>IP Address</th>
                  <th>Source</th>
                  <th>Port</th>
                  <th>Username</th>
                  <th>Password</th>
                  <th className="ip-th-filter">
                    <select
                      className="ip-th-filter-select"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      aria-label="Filter by status"
                    >
                      <option value="all">Status</option>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </th>
                  <th>Risk</th>
                  <th className="col-center">In Use</th>
                  <th>Bound Accounts</th>
                  <th>Device</th>
                  <th className="col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty-cell">
                      {searchQuery || statusFilter !== 'all'
                        ? 'No IPs match your filters.'
                        : 'No IPs recorded.'}
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        className="ams-check"
                        checked={selected.has(row.id)}
                        onChange={(e) => {
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(row.id);
                            else n.delete(row.id);
                            return n;
                          });
                        }}
                      />
                    </td>
                    <td className="col-mono">{row.ip_address}</td>
                    <td className="text-[12.5px] text-ams-muted">
                      {row.proxy_provider || (row.username?.startsWith('res_') ? 'Proxy vendor' : '—')}
                    </td>
                    <td className="col-mono">{row.port}</td>
                    <td className="col-mono">{row.username}</td>
                    <td>
                      <span className="col-mono">
                        {shownPw[row.id] ? row.password : '••••••••'}
                      </span>
                      <button
                        type="button"
                        className="ml-2 inline-flex align-middle text-ams-blue"
                        onClick={() => setShownPw((p) => ({ ...p, [row.id]: !p[row.id] }))}
                        aria-label={shownPw[row.id] ? 'Hide password' : 'Show password'}
                      >
                        {shownPw[row.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </td>
                    <td>
                      <ActiveToggle
                        active={row.active}
                        onChange={(v) => updateRow(row.id, { active: v, status: v ? 'ACTIVE' : 'INACTIVE' })}
                      />
                    </td>
                    <td>
                      <span className={`font-bold ${riskTone(row.risk_count)}`}>
                        {row.risk_count}
                      </span>
                    </td>
                    <td className={`col-center font-semibold ${(ipBindings[row.id]?.length || row.in_use) > 0 ? 'text-ams-ink' : 'col-muted'}`}>
                      {ipBindings[row.id]?.length ?? row.in_use ?? 0}
                    </td>
                    <td className="text-[12.5px] text-ams-muted">
                      {(ipBindings[row.id] || []).join(', ') || '—'}
                    </td>
                    <td className="col-mono text-[12px]">{ipDevices[row.id] || '—'}</td>
                    <td className="col-action">
                      <div className="col-action-btns">
                        <IconTooltip label="Edit IP">
                          <button
                            type="button"
                            className="table-icon-btn"
                            onClick={() => openEdit(row)}
                            aria-label="Edit IP"
                          >
                            <Pencil size={15} strokeWidth={2} />
                          </button>
                        </IconTooltip>
                        {row.in_use > 0 ? (
                          <IconTooltip label="In use — cannot delete">
                            <button
                              type="button"
                              className="table-icon-btn table-icon-btn--danger opacity-40"
                              disabled
                              aria-label="Delete IP (in use)"
                            >
                              <Trash2 size={15} strokeWidth={2} />
                            </button>
                          </IconTooltip>
                        ) : (
                          <IconTooltip label="Delete IP">
                            <button
                              type="button"
                              className="table-icon-btn table-icon-btn--danger"
                              onClick={() => deleteRow(row.id)}
                              aria-label="Delete IP"
                            >
                              <Trash2 size={15} strokeWidth={2} />
                            </button>
                          </IconTooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && total > 0 && (
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

      <Toast open={!!toast} message={toast} onClose={() => setToast('')} />

      <ConfirmDialog
        open={!!deleteConfirm}
        title={deleteConfirm?.title || 'Delete?'}
        message={deleteConfirm?.message || ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />

      <Drawer
        open={!!drawer}
        title="Edit IP"
        onClose={closeEdit}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={closeEdit}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={saveEdit}>
              Save
            </button>
          </>
        )}
      >
        {drawer && editForm && (
          <>
            <div className="drawer-locked">
              <div className="drawer-locked-label">In use · Risk</div>
              <div className="drawer-locked-value">
                {drawer.in_use} account{drawer.in_use === 1 ? '' : 's'}
                {' · '}
                <span className={riskTone(drawer.risk_count)}>{drawer.risk_count} risk</span>
              </div>
            </div>
            <div className="drawer-fields">
              <label className="drawer-field">
                <span className="drawer-label">IP address</span>
                <input
                  className="input font-mono"
                  value={editForm.ip_address}
                  onChange={(e) => setEditForm((f) => ({ ...f, ip_address: e.target.value }))}
                />
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Port</span>
                <input
                  className="input font-mono"
                  value={editForm.port}
                  onChange={(e) => setEditForm((f) => ({ ...f, port: e.target.value }))}
                />
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Username</span>
                <input
                  className="input"
                  value={editForm.username}
                  onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                />
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Password</span>
                <input
                  className="input font-mono"
                  type="text"
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                />
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Status</span>
                <select
                  className="input"
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>
            </div>
          </>
        )}
      </Drawer>

      <Drawer
        open={importOpen}
        title="Import IPs"
        onClose={closeImport}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={closeImport}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runImport}
              disabled={importMut.isPending || !importPreview?.validCount}
            >
              {importMut.isPending ? 'Importing…' : `Import ${importPreview?.validCount || 0} IP${importPreview?.validCount === 1 ? '' : 's'}`}
            </button>
          </>
        )}
      >
        <p className="drawer-hint">
          Upload a CSV file to add many IPs at once. Download the template below if you need the correct format.
        </p>
        <div className="drawer-fields">
          <div className="drawer-field">
            <div className="ip-import-picker">
              <input
                ref={importInputRef}
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportFile}
              />
              <button
                type="button"
                className="ip-import-dropzone"
                onClick={() => importInputRef.current?.click()}
              >
                <FileSpreadsheet size={22} strokeWidth={1.75} className="text-ams-faint" />
                <span className="ip-import-dropzone-name">
                  {importFileName || 'Choose CSV file'}
                </span>
                <span className="ip-import-dropzone-hint">
                  {importFileName ? 'Click to replace file' : 'Use the template for the correct columns'}
                </span>
              </button>
            </div>
          </div>
          <div className="ip-import-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadIpImportTemplate}>
              Download template
            </button>
          </div>
          {importPreview && (
            <div className="ip-import-preview">
              <p className="ip-import-summary">
                <span className="font-semibold text-ams-ink">{importPreview.validCount}</span>
                {' '}valid row{importPreview.validCount === 1 ? '' : 's'}
                {importPreview.errors.length > 0 && (
                  <>
                    {' · '}
                    <span className="text-ams-warn">{importPreview.errors.length} row error{importPreview.errors.length === 1 ? '' : 's'}</span>
                  </>
                )}
              </p>
              {importPreview.sample.length > 0 && (
                <div className="ip-import-sample">
                  <p className="drawer-label">Preview</p>
                  <ul>
                    {importPreview.sample.map((row) => (
                      <li key={`${row.proxy_provider}-${row.ip_address}`}>
                        <span className="font-mono">{row.proxy_provider || '—'}</span>
                        {' · '}
                        <span className="font-mono">{row.ip_address}</span>
                        {row.port ? `:${row.port}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {importPreview.errors.length > 0 && (
                <div className="ip-import-errors">
                  <p className="drawer-label">Row errors</p>
                  <ul>
                    {importPreview.errors.slice(0, 5).map((err) => (
                      <li key={`${err.line}-${err.message}`}>
                        Line {err.line}: {err.message}
                        {err.ip_address ? ` (${err.ip_address})` : ''}
                      </li>
                    ))}
                    {importPreview.errors.length > 5 && (
                      <li>…and {importPreview.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
              <p className="drawer-hint ip-import-note">
                Duplicate IP addresses already in the ledger are skipped automatically.
              </p>
            </div>
          )}
        </div>
      </Drawer>

      <Drawer
        open={createOpen}
        title="Add IP"
        onClose={closeCreate}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={closeCreate}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveCreate}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? 'Saving…' : 'Add IP'}
            </button>
          </>
        )}
      >
        <p className="drawer-hint">
          Enter proxy details from procurement. Active IPs are available for registration and delivery.
        </p>
        <div className="drawer-fields">
          <label className="drawer-field">
            <span className="drawer-label">IP address</span>
            <input
              className="input font-mono"
              placeholder="e.g. 103.45.12.88"
              value={createForm.ip_address}
              onChange={(e) => setCreateForm((f) => ({ ...f, ip_address: e.target.value }))}
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Source / provider</span>
            <input
              className="input"
              placeholder="e.g. Proxy vendor"
              value={createForm.proxy_provider}
              onChange={(e) => setCreateForm((f) => ({ ...f, proxy_provider: e.target.value }))}
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Port</span>
            <input
              className="input font-mono"
              placeholder="e.g. 8080"
              value={createForm.port}
              onChange={(e) => setCreateForm((f) => ({ ...f, port: e.target.value }))}
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Username</span>
            <input
              className="input"
              value={createForm.username}
              onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Password</span>
            <input
              className="input font-mono"
              type="text"
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Status</span>
            <select
              className="input"
              value={createForm.status}
              onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>
      </Drawer>
    </div>
  );
}
