import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import ConfirmDialog from '../components/ConfirmDialog';
import Toast from '../components/Toast';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { isDeviceCodePattern, tradingBrandFromDeviceCode } from '../lib/device-code';
import { statusMeta } from '../lib/account-status-labels';
import { accountToOperatorRow } from '../lib/account-operator-meta';
import { getSiteChipClass, SITES } from '../lib/sites';
import { filterDevicesBySite } from '../lib/resource-mappers';
import { operatorSiteKey } from '../lib/operator-scope';

const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'];
const CURRENCY_OPTIONS = ['MYR', 'SGD'];
const DEVICE_PAGE_SIZE = 20;
const LOCATION_OPTIONS = [
  { value: 'my', label: 'Malaysia' },
  { value: 'pp', label: 'Poipet' },
  // Legacy SGD rows without site_key
  { value: 'shared', label: 'Unassigned' },
];

function devicePrefix(deviceName = '') {
  return String(deviceName || '').split('-')[0]?.toUpperCase() || '';
}

/** Site implied by Device ID prefix (MYR/PP). SGD has no implied site. */
function prefixImpliedSite(deviceName = '') {
  const prefix = devicePrefix(deviceName);
  if (prefix === 'PP') return 'pp';
  if (prefix === 'MYR' || prefix === 'MY') return 'my';
  return null;
}

function deviceLocationKey(device = {}) {
  const name = typeof device === 'string' ? device : device?.device_name;
  const stored = typeof device === 'object' ? device?.site_key : null;
  if (stored === 'my' || stored === 'pp') return stored;
  const implied = prefixImpliedSite(name);
  if (implied) return implied;
  if (devicePrefix(name) === 'SGD') return 'shared';
  return '';
}

function deviceLocationLabel(device = {}) {
  const key = deviceLocationKey(device);
  return LOCATION_OPTIONS.find((o) => o.value === key)?.label || '—';
}

/** Resolve site_key when adding/editing a device. */
function resolveDeviceSiteKey(deviceName, { profile, headerSite, manualSite } = {}) {
  const implied = prefixImpliedSite(deviceName);
  if (implied) return implied;
  if (devicePrefix(deviceName) !== 'SGD') return null;
  if (manualSite === 'my' || manualSite === 'pp') return manualSite;
  const op = operatorSiteKey(profile);
  if (op === 'my' || op === 'pp') return op;
  if (headerSite === 'my' || headerSite === 'pp') return headerSite;
  return null;
}

function isSgdDevice(deviceName = '') {
  return devicePrefix(deviceName) === 'SGD';
}

function currencyFromStored(value, deviceName = '') {
  const raw = String(value || '').trim().toUpperCase();
  if (CURRENCY_OPTIONS.includes(raw)) return raw;
  if (raw.startsWith('SN-MY') || raw.startsWith('MYR')) return 'MYR';
  if (raw.startsWith('SN-SGD') || raw.startsWith('SGD')) return 'SGD';
  const prefix = String(deviceName || '').split('-')[0]?.toUpperCase();
  if (prefix === 'MYR') return 'MYR';
  if (prefix === 'SGD') return 'SGD';
  return '';
}

/** serial_number is UNIQUE — never store bare "MYR"/"SGD" or a second save will fail silently. */
function serialFromCurrency(currency, deviceName) {
  const c = String(currency || '').toUpperCase();
  if (!CURRENCY_OPTIONS.includes(c)) return null;
  const slug = String(deviceName || 'device').replace(/\s+/g, '-').toUpperCase() || 'DEVICE';
  return `SN-${c}-${slug}`;
}

function boundAccountLabel(bound) {
  const channelRank = (ch) => {
    const c = String(ch || '').toLowerCase();
    if (c.includes('normal')) return 0;
    if (c.includes('business')) return 1;
    return 2;
  };
  const names = bound
    .slice()
    .sort((a, b) => channelRank(a.channel) - channelRank(b.channel)
      || String(a.account_name || '').localeCompare(String(b.account_name || '')))
    .map((a) => a.account_name)
    .filter(Boolean);
  return names.length ? names.join(', ') : '—';
}

const emptyForm = () => ({
  device_name: '',
  serial_number: '',
  status: 'ACTIVE',
  model: '',
});

export default function DevicesPage() {
  const { profile } = useAuth();
  const { site } = useSite();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [detailDevice, setDetailDevice] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('ACTIVE');
  const [editCurrency, setEditCurrency] = useState('');
  const [editSiteKey, setEditSiteKey] = useState('');
  const [addForm, setAddForm] = useState(emptyForm);
  const [addSiteKey, setAddSiteKey] = useState('');
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('success');
  const [statusBusyId, setStatusBusyId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function showToast(message, tone = 'success') {
    setToastTone(tone);
    setToast(message);
    setTimeout(() => setToast(''), tone === 'success' ? 3500 : 4500);
  }

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await api.get('/devices', { params: { limit: 500 } });
      return res.data?.data || [];
    },
  });

  const { data: accountsRaw = [] } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 500 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
  });

  const rows = useMemo(() => {
    const bannedByDevice = accountsRaw
      .filter((a) => a.status === 'BANNED')
      .reduce((acc, a) => {
        if (a.device_id) acc[a.device_id] = (acc[a.device_id] || 0) + 1;
        return acc;
      }, {});

    return filterDevicesBySite(devices, site).map((d) => {
      const bound = accountsRaw.filter((a) => a.device_id === d.id && a.status !== 'RECYCLED');
      const locationKey = deviceLocationKey(d);
      return {
        ...d,
        locationKey,
        location: deviceLocationLabel(d),
        tradingBrand: tradingBrandFromDeviceCode(d.device_name),
        currency: currencyFromStored(d.serial_number, d.device_name),
        boundAccount: boundAccountLabel(bound),
        accountCount: bound.length,
        banCount: bannedByDevice[d.id] || 0,
        history: bound,
      };
    });
  }, [devices, accountsRaw, site]);

  const brandOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.tradingBrand) set.add(r.tradingBrand); });
    return [...set].sort();
  }, [rows]);

  const searchQuery = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (brandFilter !== 'all') list = list.filter((r) => r.tradingBrand === brandFilter);
    if (currencyFilter !== 'all') {
      list = list.filter((r) => (r.currency || '') === currencyFilter);
    }
    if (locationFilter !== 'all') {
      list = list.filter((r) => r.locationKey === locationFilter);
    }
    if (searchQuery) {
      list = list.filter((r) => {
        const hay = [
          r.device_name, r.location, r.boundAccount, r.tradingBrand, r.currency, r.status,
        ].join(' ').toLowerCase();
        return hay.includes(searchQuery);
      });
    }
    return list.slice().sort((a, b) => String(a.device_name || '').localeCompare(
      String(b.device_name || ''),
      undefined,
      { numeric: true },
    ));
  }, [rows, statusFilter, brandFilter, currencyFilter, locationFilter, searchQuery]);

  useEffect(() => { setPage(1); }, [search, statusFilter, brandFilter, currencyFilter, locationFilter, site]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / DEVICE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * DEVICE_PAGE_SIZE, safePage * DEVICE_PAGE_SIZE);
  const pageStart = filtered.length ? (safePage - 1) * DEVICE_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(safePage * DEVICE_PAGE_SIZE, filtered.length);

  const detailRow = detailDevice
    ? rows.find((r) => r.id === detailDevice.id) || detailDevice
    : null;

  const patchMut = useMutation({
    mutationFn: async ({ id, body }) => {
      const { data } = await api.patch(`/devices/${id}`, body);
      return data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      if (!vars?.silent) {
        setDetailDevice(null);
        showToast(`Device saved as ${data.device_name}`);
      } else if (detailDevice?.id === data.id) {
        setDetailDevice(data);
      }
    },
    onError: (e) => {
      showToast(e?.response?.data?.error || e.message || 'Save failed', 'error');
    },
    onSettled: () => setStatusBusyId(null),
  });

  const createMut = useMutation({
    mutationFn: async (body) => {
      const { data } = await api.post('/devices', body);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      setAddOpen(false);
      setAddForm(emptyForm());
      setAddSiteKey('');
      showToast(`Device ${data.device_name} added`);
    },
    onError: (e) => {
      showToast(e?.response?.data?.error || e.message || 'Create failed', 'error');
    },
  });

  const deleteMut = useMutation({
    mutationFn: async ({ id }) => {
      await api.delete(`/devices/${id}`);
      return id;
    },
    onSuccess: (_id, vars) => {
      const name = vars?.name || 'Device';
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      if (detailDevice?.id === vars?.id) setDetailDevice(null);
      setDeleteConfirm(null);
      showToast(`${name} deleted`);
    },
    onError: (e) => {
      showToast(e?.response?.data?.error || e.message || 'Delete failed', 'error');
      setDeleteConfirm(null);
    },
  });

  function openDetail(row) {
    setDetailDevice(row);
    setEditName(row.device_name || '');
    setEditStatus(row.status || 'ACTIVE');
    setEditCurrency(currencyFromStored(row.serial_number, row.device_name) || '');
    const loc = deviceLocationKey(row);
    setEditSiteKey(loc === 'my' || loc === 'pp' ? loc : '');
  }

  function saveDetail() {
    const name = editName.trim().toUpperCase();
    if (!name) {
      showToast('Device ID is required', 'error');
      return;
    }
    if (!detailRow?.id) return;
    const currency = (editCurrency || currencyFromStored('', name) || '').toUpperCase();
    const site_key = resolveDeviceSiteKey(name, {
      profile,
      headerSite: site,
      manualSite: isSgdDevice(name) ? editSiteKey : null,
    });
    if (isSgdDevice(name) && !site_key) {
      showToast('Choose Location (Malaysia or Poipet) for SGD devices', 'error');
      return;
    }
    patchMut.mutate({
      id: detailRow.id,
      body: {
        device_name: name,
        status: editStatus,
        serial_number: serialFromCurrency(currency, name),
        site_key: site_key || null,
      },
    });
  }

  function submitAdd() {
    const name = addForm.device_name.trim().toUpperCase();
    if (!name) {
      showToast('Device ID is required', 'error');
      return;
    }
    const currency = (
      addForm.serial_number.trim()
      || currencyFromStored('', name)
      || ''
    ).toUpperCase();
    const site_key = resolveDeviceSiteKey(name, {
      profile,
      headerSite: site,
      manualSite: isSgdDevice(name) ? addSiteKey : null,
    });
    if (isSgdDevice(name) && !site_key) {
      showToast('Choose Location (Malaysia or Poipet) for SGD devices', 'error');
      return;
    }
    createMut.mutate({
      device_name: name,
      serial_number: serialFromCurrency(currency, name),
      status: addForm.status || 'ACTIVE',
      model: addForm.model.trim() || null,
      brand: 'Samsung',
      site_key: site_key || null,
    });
  }

  function openAdd() {
    const op = operatorSiteKey(profile);
    const preset = (op === 'my' || op === 'pp')
      ? op
      : (site === 'my' || site === 'pp' ? site : '');
    setAddSiteKey(preset);
    setAddForm(emptyForm());
    setAddOpen(true);
  }

  function changeRowStatus(row, nextStatus) {
    if (!row?.id || row.status === nextStatus) return;
    setStatusBusyId(row.id);
    patchMut.mutate({
      id: row.id,
      body: { status: nextStatus },
      silent: true,
    });
    showToast(`${row.device_name} → ${nextStatus}`);
  }

  function requestDeleteDevice(row) {
    if (!row?.id) return;
    const bound = row.accountCount || 0;
    setDeleteConfirm({
      id: row.id,
      name: row.device_name || 'Device',
      title: `Delete ${row.device_name || 'device'}?`,
      message: bound > 0
        ? `This cannot be undone. ${bound} bound account(s) will be unlinked from this device.`
        : 'This cannot be undone. The device will be permanently removed from the ledger.',
    });
  }

  function confirmDeleteDevice() {
    if (!deleteConfirm?.id || deleteMut.isPending) return;
    deleteMut.mutate({ id: deleteConfirm.id, name: deleteConfirm.name });
  }

  const editPreviewBrand = tradingBrandFromDeviceCode(editName);
  const addPreviewBrand = tradingBrandFromDeviceCode(addForm.device_name);
  const editPatternOk = !editName.trim() || isDeviceCodePattern(editName.trim());
  const addPatternOk = !addForm.device_name.trim() || isDeviceCodePattern(addForm.device_name.trim());
  const opSite = operatorSiteKey(profile);
  const locationLockedToOp = opSite === 'my' || opSite === 'pp';
  const addResolvedSite = resolveDeviceSiteKey(addForm.device_name, {
    profile,
    headerSite: site,
    manualSite: addSiteKey,
  });
  const addNeedsSitePick = isSgdDevice(addForm.device_name) && !locationLockedToOp && !(site === 'my' || site === 'pp');
  const editNeedsSitePick = isSgdDevice(editName);

  return (
    <div>
      <PageHead
        title="Devices"
        description="Farm phone inventory — Device ID, site location, currency, and bound accounts. SGD location follows the operator’s site."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-ink">{filtered.length}</span>
            <span>shown ·</span>
            <span className="font-semibold text-ams-ink">{rows.length}</span>
            <span>total</span>
          </div>
        )}
      />

      <div className="page-filter-bar">
        <div className="page-filter-search !flex-none w-full max-w-xs">
          <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
          <input
            className="input"
            type="search"
            placeholder="Search device, account, brand, currency…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search devices"
          />
        </div>
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            aria-label="Filter by brand"
          >
            <option value="all">All brands</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold shadow-card"
          onClick={openAdd}
        >
          <Plus size={15} strokeWidth={2} />
          Add device
        </button>
      </div>

      <div className="data-panel card overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-ams-faint">Loading…</p>
        ) : (
          <>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Device ID</th>
                    <th className="ip-th-filter">
                      <select
                        className="ip-th-filter-select"
                        value={locationFilter}
                        onChange={(e) => setLocationFilter(e.target.value)}
                        aria-label="Filter by location"
                      >
                        <option value="all">Location</option>
                        {LOCATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </th>
                    <th>Bound Account</th>
                    <th className="col-center">Accounts</th>
                    <th className="col-center">Bans</th>
                    <th>Brand</th>
                    <th className="ip-th-filter">
                      <select
                        className="ip-th-filter-select"
                        value={currencyFilter}
                        onChange={(e) => setCurrencyFilter(e.target.value)}
                        aria-label="Filter by currency"
                      >
                        <option value="all">Currency</option>
                        {CURRENCY_OPTIONS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </th>
                    <th className="col-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={8} className="empty-cell">No devices match the filters.</td></tr>
                  ) : pageRows.map((row) => (
                    <tr key={row.id}>
                      <td className="col-mono font-semibold">
                        <button
                          type="button"
                          className="text-ams-blue hover:underline"
                          onClick={() => openDetail(row)}
                        >
                          {row.device_name}
                        </button>
                      </td>
                      <td>
                        {row.locationKey === 'shared'
                          ? <span className="badge badge-default" title="Assign Malaysia or Poipet when editing">{row.location}</span>
                          : row.locationKey
                            ? <span className={getSiteChipClass(row.locationKey)}>{row.location}</span>
                            : <span className="col-muted">—</span>}
                      </td>
                      <td className="font-semibold text-ams-blue">{row.boundAccount}</td>
                      <td className="col-center">{row.accountCount}</td>
                      <td className={`col-center ${row.banCount >= 3 ? 'text-ams-warn font-semibold' : ''}`}>
                        {row.banCount}
                      </td>
                      <td>
                        {row.tradingBrand
                          ? <span className="badge badge-default">{row.tradingBrand}</span>
                          : <span className="col-muted">—</span>}
                      </td>
                      <td className="col-mono col-muted">{row.currency || '—'}</td>
                      <td className="col-center">
                        <label className="page-filter-chip">
                          <select
                            className="page-filter-chip-select"
                            value={row.status || 'ACTIVE'}
                            disabled={statusBusyId === row.id}
                            onChange={(e) => changeRowStatus(row, e.target.value)}
                            aria-label={`Status for ${row.device_name}`}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > DEVICE_PAGE_SIZE && (
              <div className="tk-pager px-4 pb-4">
                <p className="tk-pager-meta">
                  Showing {pageStart}–{pageEnd} of {filtered.length} devices
                </p>
                <div className="tk-pager-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Drawer
        open={!!detailRow}
        title="Device"
        onClose={() => setDetailDevice(null)}
        footer={(
          <>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => requestDeleteDevice(detailRow)}
              disabled={deleteMut.isPending || !detailRow?.id}
            >
              Delete
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={saveDetail}
              disabled={patchMut.isPending || deleteMut.isPending}
            >
              {patchMut.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      >
        {detailRow && (
          <div className="space-y-4">
            <div className="drawer-fields">
              <label className="drawer-field">
                <span className="drawer-label">Device ID</span>
                <input
                  className="input font-mono"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. SGD-FW-001"
                  autoComplete="off"
                />
                {!editPatternOk && (
                  <span className="mt-1 text-[12px] text-ams-warn">
                    Prefer PREFIX-MIDDLE-UNIT (e.g. SGD-FW-001).
                  </span>
                )}
                {editPatternOk && editPreviewBrand && (
                  <span className="mt-1 text-[12px] text-ams-muted">
                    Trading brand: <strong>{editPreviewBrand}</strong>
                  </span>
                )}
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Status</span>
                <select
                  className="input"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Currency</span>
                <select
                  className="input"
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value)}
                >
                  <option value="">Select currency</option>
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              {editNeedsSitePick ? (
                <label className="drawer-field">
                  <span className="drawer-label">Location</span>
                  <select
                    className="input"
                    value={editSiteKey}
                    onChange={(e) => setEditSiteKey(e.target.value)}
                    disabled={locationLockedToOp}
                  >
                    <option value="">Select site</option>
                    <option value="my">{SITES.my.name}</option>
                    <option value="pp">{SITES.pp.name}</option>
                  </select>
                  {locationLockedToOp && (
                    <span className="mt-1 text-[12px] text-ams-muted">
                      Locked to your site ({SITES[opSite]?.name}).
                    </span>
                  )}
                </label>
              ) : (
                <div className="drawer-locked">
                  <div className="drawer-locked-label">Location</div>
                  <div className="text-sm">{deviceLocationLabel({ device_name: editName, site_key: editSiteKey || detailRow.site_key })}</div>
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-ams-muted">Accounts on this device</div>
              {detailRow.history?.length === 0 ? (
                <p className="text-sm text-ams-muted">No accounts bound.</p>
              ) : (
                <ul className="space-y-2">
                  {(detailRow.history || []).map((a) => (
                    <li key={a.id} className="flex items-center justify-between rounded-lg border border-ams-line px-3 py-2 text-[13px]">
                      <span className="font-semibold">{a.account_name}</span>
                      <span className={`badge ${statusMeta(a.status).pill}`}>
                        {statusMeta(a.status).label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-ams-faint">
              {detailRow.banCount || 0} ban(s) recorded on this device
            </p>
          </div>
        )}
      </Drawer>

      <Drawer
        open={addOpen}
        title="Add device"
        onClose={() => setAddOpen(false)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost flex-1" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={submitAdd}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? 'Saving…' : 'Add device'}
            </button>
          </>
        )}
      >
        <div className="drawer-fields">
          <label className="drawer-field">
            <span className="drawer-label">Device ID</span>
            <input
              className="input font-mono"
              value={addForm.device_name}
              onChange={(e) => setAddForm((f) => ({ ...f, device_name: e.target.value }))}
              placeholder="e.g. SGD-FW-001"
              autoComplete="off"
            />
            {!addPatternOk && (
              <span className="mt-1 text-[12px] text-ams-warn">
                Prefer PREFIX-MIDDLE-UNIT (e.g. SGD-WB-002).
              </span>
            )}
            {addPatternOk && addPreviewBrand && (
              <span className="mt-1 text-[12px] text-ams-muted">
                Trading brand: <strong>{addPreviewBrand}</strong>
              </span>
            )}
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Status</span>
            <select
              className="input"
              value={addForm.status}
              onChange={(e) => setAddForm((f) => ({ ...f, status: e.target.value }))}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Currency</span>
            <select
              className="input"
              value={addForm.serial_number}
              onChange={(e) => setAddForm((f) => ({ ...f, serial_number: e.target.value }))}
            >
              <option value="">Auto from Device ID</option>
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          {isSgdDevice(addForm.device_name) || prefixImpliedSite(addForm.device_name) ? (
            addNeedsSitePick ? (
              <label className="drawer-field">
                <span className="drawer-label">Location</span>
                <select
                  className="input"
                  value={addSiteKey}
                  onChange={(e) => setAddSiteKey(e.target.value)}
                >
                  <option value="">Select site</option>
                  <option value="my">{SITES.my.name}</option>
                  <option value="pp">{SITES.pp.name}</option>
                </select>
              </label>
            ) : (
              <div className="drawer-locked">
                <div className="drawer-locked-label">Location</div>
                <div className="text-sm">
                  {addResolvedSite
                    ? SITES[addResolvedSite]?.name
                    : '—'}
                  {isSgdDevice(addForm.device_name) && locationLockedToOp && (
                    <span className="mt-1 block text-[12px] text-ams-muted">
                      Auto from your site profile.
                    </span>
                  )}
                  {isSgdDevice(addForm.device_name) && !locationLockedToOp && (site === 'my' || site === 'pp') && (
                    <span className="mt-1 block text-[12px] text-ams-muted">
                      Auto from active site filter.
                    </span>
                  )}
                </div>
              </div>
            )
          ) : null}
          <label className="drawer-field">
            <span className="drawer-label">Model</span>
            <input
              className="input"
              value={addForm.model}
              onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="Optional"
            />
          </label>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!deleteConfirm}
        title={deleteConfirm?.title || 'Delete device?'}
        message={deleteConfirm?.message || ''}
        confirmLabel={deleteMut.isPending ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        danger
        onConfirm={confirmDeleteDevice}
        onCancel={() => !deleteMut.isPending && setDeleteConfirm(null)}
      />

      <Toast open={!!toast} message={toast} tone={toastTone} onClose={() => setToast('')} />
    </div>
  );
}
