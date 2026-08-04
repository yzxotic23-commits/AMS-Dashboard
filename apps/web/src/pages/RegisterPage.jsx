import { useMemo, useState, useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import ConfirmDialog from '../components/ConfirmDialog';
import IconTooltip from '../components/IconTooltip';
import ProxyCredentialPanel from '../components/ProxyCredentialPanel';
import ProxyIpPicker from '../components/ProxyIpPicker';
import Toast from '../components/Toast';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { serializeAccountNotes } from '../lib/account-operator-meta';
import { inferBrandFromDevice } from '../lib/account-status-labels';
import { useOperatorRoster, operatorDisplayName } from '../hooks/useOperatorRoster';
import {
  filterRosterForProfile,
  isAdminProfile,
  operatorDisplayLabel,
  operatorSiteKey,
} from '../lib/operator-scope';
import { useAccountMutations } from '../hooks/useOperatorAccounts';
import { useRegistrationStats, useRegistrationLog } from '../hooks/useRegistrationStats';
import { useFreeIps, useDeviceOptions, useSimOptions } from '../hooks/useResourceOptions';
import { matchSimIdForPrepared } from '../lib/resource-mappers';
import {
  DEVICE_CHANNEL_SLOTS,
  DEVICE_MAX_SLOTS,
  deviceSlotAvailability,
  formatDeviceRegisterOption,
  normalizeDeviceChannel,
} from '../lib/device-location';
import { formatProxyOneLine, proxyFieldsFromIp } from '../lib/proxy-display';
import {
  buildIpBindings,
  isIpSelectableForAccount,
} from '../lib/ip-ready';
import { useAllAccounts } from '../hooks/useOperatorAccounts';
import { toastCopy } from '../lib/operator-copy';
import { dismissPreparedRow, usePreparedQueue, addPreparedNumber, deletePreparedNumber } from '../hooks/usePreparedQueue';
import {
  defaultTelco,
  normalizeTelco,
  TELCO_OPTIONS,
} from '../lib/telco-options';

const FAIL_REASONS = ['Number rejected', 'IP flagged', 'No verification code', 'Other'];
const TABS = [
  { id: 'prepared', label: 'Prepared Numbers' },
  { id: 'log', label: 'Registration Log' },
];

function NeedBadge({ need }) {
  if (!need) return <span className="badge badge-default">Not required</span>;
  return <span className="badge badge-warn">Required</span>;
}

function DrawerSection({ title, children }) {
  return (
    <div className="drawer-section">
      <div className="drawer-section-title">{title}</div>
      {children}
    </div>
  );
}

/** Prepared queue site must be my or pp — never the page filter "all". */
function preparedSiteKeyForAdd(pageSite, profile) {
  if (pageSite === 'my' || pageSite === 'pp') return pageSite;
  const sk = operatorSiteKey(profile);
  return sk === 'pp' ? 'pp' : 'my';
}

export default function RegisterPage() {
  const { site } = useSite();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: rows = { my: [], pp: [] }, isLoading: queueLoading } = usePreparedQueue(site);
  const [drawer, setDrawer] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    phone: '',
    telco: defaultTelco(),
    site_key: 'my',
    note: '',
  });
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [form, setForm] = useState({
    deviceId: '', slot: DEVICE_CHANNEL_SLOTS[0], ipId: '', accountName: '', owner: '', result: 'ok', failReason: FAIL_REASONS[0],
  });
  const { data: operatorsRaw = [] } = useOperatorRoster();
  const operators = useMemo(
    () => filterRosterForProfile(operatorsRaw, profile),
    [operatorsRaw, profile],
  );
  const defaultOperator = isAdminProfile(profile)
    ? (operators[0] ? operatorDisplayName(operators[0]) : '')
    : operatorDisplayLabel(profile);
  const drawerOpen = !!drawer;
  const { data: ledgerAccounts = [], isFetching: ledgerFetching } = useAllAccounts({ enabled: drawerOpen });
  const [toast, setToast] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState('prepared');
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(20);
  const { createAccount, logRegistration } = useAccountMutations();
  const { data: regStats } = useRegistrationStats(site);
  const { data: regLogData, isFetching: regLogFetching } = useRegistrationLog(
    logPage,
    logPageSize,
    { enabled: tab === 'log' },
  );
  const regLog = regLogData?.rows ?? [];
  const regLogTotal = regLogData?.total ?? 0;
  const regLogTotalPages = Math.max(1, Math.ceil(regLogTotal / logPageSize));
  const regLogSafePage = Math.min(logPage, regLogTotalPages);
  const regLogStart = regLogTotal === 0 ? 0 : (regLogSafePage - 1) * logPageSize + 1;
  const regLogEnd = Math.min(regLogSafePage * logPageSize, regLogTotal);

  const siteKey = drawer?.siteKey || 'my';
  const { list: freeIps, isLoading: ipsLoading } = useFreeIps({ enabled: drawerOpen });
  const { list: devices, isLoading: devicesLoading, expandMessage: devicesExpanded } = useDeviceOptions(siteKey, { enabled: drawerOpen });
  const { list: sims, isLoading: simsLoading } = useSimOptions(siteKey, { enabled: drawerOpen });
  const resourcesLoading = drawerOpen && (ledgerFetching || ipsLoading || devicesLoading || simsLoading);
  const ipBindings = useMemo(() => buildIpBindings(ledgerAccounts), [ledgerAccounts]);
  const drawerFormInit = useRef(null);
  const expandToastShown = useRef('');

  useEffect(() => {
    if (!devicesExpanded || devicesExpanded === expandToastShown.current) return;
    expandToastShown.current = devicesExpanded;
    setToast(devicesExpanded);
    const t = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(t);
  }, [devicesExpanded]);

  useEffect(() => {
    setLogPage(1);
  }, [tab, site, logPageSize]);

  useEffect(() => {
    if (!regLogData) return;
    if (logPage > regLogTotalPages) setLogPage(regLogTotalPages);
  }, [regLogData, logPage, regLogTotalPages]);

  const availableSlots = useMemo(() => {
    if (!form.deviceId) return DEVICE_CHANNEL_SLOTS;
    const taken = new Set(
      ledgerAccounts
        .filter((a) => a.device_id === form.deviceId)
        .map((a) => normalizeDeviceChannel(a.channel)),
    );
    return DEVICE_CHANNEL_SLOTS.filter((slot) => !taken.has(slot));
  }, [form.deviceId, ledgerAccounts]);

  const selectedIp = useMemo(
    () => freeIps.find((ip) => ip.id === form.ipId) || null,
    [freeIps, form.ipId],
  );

  const list = useMemo(() => {
    if (site === 'all') {
      return [
        ...rows.my.map((r) => ({ ...r, siteKey: 'my' })),
        ...rows.pp.map((r) => ({ ...r, siteKey: 'pp' })),
      ];
    }
    return (rows[site] || []).map((r) => ({ ...r, siteKey: site }));
  }, [rows, site]);

  function openAddPrepared() {
    const siteKey = preparedSiteKeyForAdd(site, profile);
    setAddForm({
      phone: '',
      telco: defaultTelco(),
      site_key: siteKey,
      note: '',
    });
    setAddOpen(true);
  }

  async function submitAddPrepared() {
    if (addSubmitting) return;
    const phone = addForm.phone.trim();
    if (!phone) {
      setToast('Phone number is required');
      setTimeout(() => setToast(''), 3500);
      return;
    }
    setAddSubmitting(true);
    try {
      const site_key = addForm.site_key === 'pp' ? 'pp' : 'my';
      await addPreparedNumber({
        phone_number: phone,
        telco: addForm.telco,
        site_key,
        note: addForm.note.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ['registrations', 'prepared'] });
      qc.invalidateQueries({ queryKey: ['sims'] });
      setAddOpen(false);
      setToast(toastCopy.preparedAdded(phone));
      setTimeout(() => setToast(''), 3800);
    } catch (e) {
      setToast(e.response?.data?.error || e.message || 'Failed to add number');
      setTimeout(() => setToast(''), 3800);
    } finally {
      setAddSubmitting(false);
    }
  }

  function requestDeletePrepared(row) {
    setDeleteConfirm({
      id: row.id,
      phone: row.phone,
      title: 'Delete prepared number?',
      message: `Remove ${row.phone} from the register queue? This cannot be undone.`,
    });
  }

  async function confirmDeletePrepared() {
    if (!deleteConfirm || deleting) return;
    setDeleting(true);
    try {
      await deletePreparedNumber(deleteConfirm.id);
      qc.invalidateQueries({ queryKey: ['registrations', 'prepared'] });
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['registrations'] });
      setToast(toastCopy.preparedDeleted(deleteConfirm.phone));
      setDeleteConfirm(null);
      setTimeout(() => setToast(''), 3800);
    } catch (e) {
      const msg = e.response?.status === 409
        ? toastCopy.preparedDeleteBlocked()
        : (e.response?.data?.error || e.message || 'Delete failed');
      setToast(msg);
      setDeleteConfirm(null);
      setTimeout(() => setToast(''), 3800);
    } finally {
      setDeleting(false);
    }
  }

  function ownerForDeviceSlot() {
    return defaultOperator;
  }

  function openReg(row) {
    setDrawer(row);
  }

  useEffect(() => {
    if (!drawer) {
      drawerFormInit.current = null;
      return;
    }
    if (resourcesLoading) return;
    if (drawerFormInit.current === drawer.id) return;

    const deviceWithSlot = devices.find(
      (d) => deviceSlotAvailability(d.id, ledgerAccounts).free > 0,
    );
    const deviceId = deviceWithSlot?.id || devices[0]?.id || '';
    const taken = new Set(
      ledgerAccounts
        .filter((a) => a.device_id === deviceId)
        .map((a) => normalizeDeviceChannel(a.channel)),
    );
    const slot = DEVICE_CHANNEL_SLOTS.find((s) => !taken.has(s)) || DEVICE_CHANNEL_SLOTS[0];
    setForm({
      deviceId,
      slot,
      ipId: freeIps.find((ip) => isIpSelectableForAccount(ip, ipBindings, null))?.id
        || freeIps[0]?.id || '',
      accountName: '',
      owner: defaultOperator,
      result: 'ok',
      failReason: FAIL_REASONS[0],
    });
    drawerFormInit.current = drawer.id;
  }, [drawer, resourcesLoading, devices, ledgerAccounts, freeIps, ipBindings, defaultOperator]);

  async function submitReg() {
    if (!drawer || submitting) return;
    setSubmitting(true);
    try {
      if (form.result === 'ok') {
        const simId = matchSimIdForPrepared(drawer.phone, drawer.telco, sims) || drawer.id;
        const ipRow = freeIps.find((ip) => ip.id === form.ipId);
        const deviceRow = devices.find((d) => d.id === form.deviceId);
        const proxyLog = proxyFieldsFromIp(ipRow);
        const created = await createAccount.mutateAsync({
          account_name: form.accountName.trim() || `Acct ${drawer.phone}`,
          phone_number: drawer.phone,
          status: 'REGISTERING',
          device_id: form.deviceId || null,
          sim_id: simId,
          ip_id: form.ipId || null,
          notes: serializeAccountNotes({
            site_key: drawer.siteKey,
            channel: form.slot,
            prepared_telco: drawer.telco,
            linked_override: false,
            nurturing_phase: 'manual',
            reference_ip_id: form.ipId || null,
            reference_ip_address: ipRow?.ip_address || '',
            owner: form.owner || ownerForDeviceSlot(),
            brand: inferBrandFromDevice(deviceRow?.device_name || deviceRow?.label),
            human_note: drawer.note || 'From register',
          }, drawer.note || 'From register'),
        });
        await logRegistration.mutateAsync({
          phone_number: drawer.phone,
          telco: drawer.telco,
          site_key: drawer.siteKey,
          result: 'ok',
          account_id: created.id,
          account_name: created.account_name,
          device_id: form.deviceId || null,
          ip_id: form.ipId || null,
          remark: drawer.note || null,
          owner: form.owner || ownerForDeviceSlot(),
          ...proxyLog,
        });
        qc.invalidateQueries({ queryKey: ['accounts'] });
        qc.invalidateQueries({ queryKey: ['ips'] });
        qc.invalidateQueries({ queryKey: ['registrations'] });
        await dismissPreparedRow(drawer.id, { need: false });
        setToast(toastCopy.registerOk(drawer.phone, form.accountName));
      } else {
        const ipRow = freeIps.find((ip) => ip.id === form.ipId);
        await logRegistration.mutateAsync({
          phone_number: drawer.phone,
          telco: drawer.telco,
          site_key: drawer.siteKey,
          result: 'fail',
          fail_reason: form.failReason,
          device_id: form.deviceId || null,
          ip_id: form.ipId || null,
          remark: drawer.note || null,
          ...proxyFieldsFromIp(ipRow),
        });
        qc.invalidateQueries({ queryKey: ['registrations'] });
        await dismissPreparedRow(drawer.id, { need: false });
        setToast(toastCopy.registerFail(drawer.phone));
      }
      setDrawer(null);
      setTab('log');
      setTimeout(() => setToast(''), 3800);
    } catch (e) {
      setToast(e.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  const needCount = list.filter((r) => r.need).length;

  return (
    <div>
      <PageHead
        title="Register"
        description="Register prepared numbers and log each attempt. Rows that need action today are flagged automatically from supply and ban rate."
        actions={needCount > 0 ? (
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-warn">{needCount}</span>
            <span>need registration</span>
          </div>
        ) : regStats?.total > 0 ? (
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-success">{regStats.successRate}%</span>
            <span>success · {regStats.success}/{regStats.total} logged</span>
          </div>
        ) : null}
      />

      <div className="tk-tab-toolbar">
        <div className="page-tab-bar tk-tab-toolbar-tabs" role="tablist" aria-label="Register sections">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            const badge = id === 'prepared'
              ? (needCount > 0 ? needCount : null)
              : (regStats?.total > 0 ? regStats.total : null);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'page-tab page-tab-active' : 'page-tab'}
                onClick={() => setTab(id)}
              >
                {label}
                {badge != null && (
                  <span className={`page-tab-badge${id === 'prepared' && needCount > 0 ? ' page-tab-badge--warn' : ''}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="tk-tab-toolbar-actions">
          {tab === 'prepared' && (
            <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={openAddPrepared}>
              <Plus size={15} strokeWidth={2} />
              Add prepared number
            </button>
          )}
        </div>
      </div>

      {tab === 'prepared' && (
        <>
      {queueLoading ? (
        <p className="py-8 text-center text-sm text-ams-muted">Loading prepared numbers…</p>
      ) : (
      <div className="data-panel card overflow-hidden">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Prepared Number</th>
                <th>Telco</th>
                {site === 'all' && <th>Site</th>}
                <th>Needs Registration</th>
                <th>Remark</th>
                <th className="col-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={site === 'all' ? 6 : 5} className="empty-cell">
                    No prepared numbers at this site.
                  </td>
                </tr>
              ) : list.map((row) => (
                <tr key={row.id}>
                  <td className="col-mono">{row.phone}</td>
                  <td>{row.telco}</td>
                  {site === 'all' && (
                    <td><span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span></td>
                  )}
                  <td><NeedBadge need={row.need} /></td>
                  <td className="col-remark">{row.note || <span className="col-muted">—</span>}</td>
                  <td className="col-action">
                    <div className="col-action-btns">
                      {row.need ? (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => openReg(row)}>
                          Fill Result
                        </button>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-sm opacity-50" disabled>
                          Not needed
                        </button>
                      )}
                      <IconTooltip label="Delete from queue">
                        <button
                          type="button"
                          className="table-icon-btn table-icon-btn--danger"
                          onClick={() => requestDeletePrepared(row)}
                          aria-label={`Delete ${row.phone}`}
                        >
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      </IconTooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
        </>
      )}

      {tab === 'log' && (
        <>
      {regStats?.total > 0 && (
        <p className="mb-3 text-[13px] text-ams-muted">
          Success rate:{' '}
          <span className="font-semibold text-ams-success">{regStats.successRate}%</span>
          {' '}({regStats.success} ok · {regStats.failed} failed · {regStats.total} total)
        </p>
      )}

      <div className="data-panel card overflow-hidden">
        <div className={`data-table-wrap${regLogFetching ? ' opacity-70' : ''}`}>
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Phone</th>
                <th>Proxy</th>
                <th>Result</th>
                <th>Reason / Account</th>
                <th>Operator</th>
              </tr>
            </thead>
            <tbody>
              {regLog.length === 0 ? (
                <tr><td colSpan={6} className="empty-cell">No registration attempts logged yet.</td></tr>
              ) : regLog.map((row) => (
                <tr key={row.id}>
                  <td className="col-mono col-muted whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="col-mono">{row.phone_number}</td>
                  <td className="col-mono text-[12px]">{formatProxyOneLine(row)}</td>
                  <td>
                    <span className={`badge ${row.result === 'ok' ? 'badge-success' : 'badge-danger'}`}>
                      {row.result === 'ok' ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td className="col-remark">
                    {row.result === 'fail' ? row.fail_reason : (row.account_name || '—')}
                  </td>
                  <td className="text-sm">{row.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {regLogTotal > 0 && (
          <div className="tk-pager px-4 pb-4">
            <label className="tk-pager-size">
              <span>Rows</span>
              <select
                className="input tk-pager-size-select"
                value={logPageSize}
                onChange={(e) => setLogPageSize(Number(e.target.value))}
                aria-label="Rows per page"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <div className="tk-pager-actions">
              <span className="tk-pager-meta">
                Showing {regLogStart}–{regLogEnd} of {regLogTotal}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={regLogSafePage <= 1}
                onClick={() => setLogPage(regLogSafePage - 1)}
              >
                Previous
              </button>
              <span className="tk-pager-page">
                Page {regLogSafePage} / {regLogTotalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={regLogSafePage >= regLogTotalPages}
                onClick={() => setLogPage(regLogSafePage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
        </>
      )}

      <Drawer
        open={!!drawer}
        title="Register Account"
        onClose={() => setDrawer(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDrawer(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={submitReg} disabled={submitting || resourcesLoading}>
              {submitting ? 'Saving…' : 'Submit Result'}
            </button>
          </>
        )}
      >
        {drawer && resourcesLoading ? (
          <p className="py-6 text-center text-sm text-ams-muted">Loading devices and proxy options…</p>
        ) : drawer && (
          <>
            <p className="drawer-hint">
              Log the registration result from the device. Proxy/IP is chosen here — not when adding a prepared number.
              On success, the account enters Activation (REGISTERING) and the number appears in SIM Card Ledger.
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Prepared number</div>
              <div className="drawer-locked-value drawer-locked-value--mono">{drawer.phone}</div>
              <div className="drawer-locked-label mt-2.5">Telco</div>
              <div className="drawer-locked-value">{drawer.telco}</div>
            </div>

            <DrawerSection title="Device assignment">
            <div className="drawer-fields">
              <label className="drawer-field">
                <span className="drawer-label">Register to device</span>
                <select
                  className="input font-mono text-[13px]"
                  value={form.deviceId}
                  onChange={(e) => {
                    const deviceId = e.target.value;
                    const taken = new Set(
                      ledgerAccounts
                        .filter((a) => a.device_id === deviceId)
                        .map((a) => normalizeDeviceChannel(a.channel)),
                    );
                    const free = DEVICE_CHANNEL_SLOTS.filter((s) => !taken.has(s));
                    setForm((f) => {
                      const slot = free[0] || DEVICE_CHANNEL_SLOTS[0];
                      return {
                        ...f,
                        deviceId,
                        slot,
                        owner: ownerForDeviceSlot(),
                      };
                    });
                  }}
                >
                  {devices.length === 0 ? (
                    <option value="">No devices for this site</option>
                  ) : devices.map((d) => {
                    const full = deviceSlotAvailability(d.id, ledgerAccounts).free === 0;
                    return (
                      <option key={d.id} value={d.id} disabled={full}>
                        {formatDeviceRegisterOption(d, ledgerAccounts)}
                      </option>
                    );
                  })}
                </select>
                <span className="mt-1 block text-[11px] text-ams-faint">
                  Max {DEVICE_MAX_SLOTS} WA slots per device — WS Normal + WS Business.
                </span>
              </label>
              <label className="drawer-field">
                <span className="drawer-label">WA slot (max 2 per device)</span>
                <select
                  className="input"
                  value={availableSlots.includes(form.slot) ? form.slot : (availableSlots[0] || '')}
                  onChange={(e) => {
                    const slot = e.target.value;
                    setForm((f) => ({
                      ...f,
                      slot,
                      owner: ownerForDeviceSlot(),
                    }));
                  }}
                >
                  {availableSlots.length === 0 ? (
                    <option value="">All 2 slots occupied</option>
                  ) : availableSlots.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Operator</span>
                <select
                  className="input"
                  value={form.owner}
                  onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                  required
                  disabled={!isAdminProfile(profile)}
                >
                  {operators.length === 0 ? (
                    <option value="">No operators — add in User management</option>
                  ) : operators.map((op) => {
                    const label = operatorDisplayName(op);
                    return <option key={op.id} value={label}>{label}</option>;
                  })}
                </select>
                <span className="mt-1 block text-[11px] text-ams-faint">
                  Control Center groups accounts by this operator.
                </span>
              </label>
            </div>
            </DrawerSection>

            <DrawerSection title="Proxy (IP ledger)">
              <label className="drawer-field">
                <span className="drawer-label">Select proxy</span>
                <ProxyIpPicker
                  ips={freeIps}
                  bindings={ipBindings}
                  value={form.ipId}
                  onChange={(ipId) => setForm((f) => ({ ...f, ipId }))}
                  disabled={ipsLoading}
                />
                <span className="mt-1 block text-[11px] text-ams-faint">
                  One row per IP with seats (0/2, 1/2). Full IPs (2/2) are hidden.
                </span>
              </label>
              <ProxyCredentialPanel ip={selectedIp} />
            </DrawerSection>

            <DrawerSection title="Account">
              <label className="drawer-field">
                <span className="drawer-label">Account name</span>
                <input
                  className="input"
                  placeholder="e.g. SBMY xxx"
                  value={form.accountName}
                  onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
                />
              </label>
            </DrawerSection>

            <div className="drawer-field">
              <span className="drawer-label">Registration result</span>
              <div className="drawer-choice-row">
                {[
                  { key: 'ok', label: 'Registered', tone: 'ok' },
                  { key: 'fail', label: 'Failed', tone: 'bad' },
                ].map(({ key, label, tone }) => (
                  <button
                    key={key}
                    type="button"
                    className={`drawer-choice drawer-choice--${tone}${form.result === key ? ' drawer-choice--on' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, result: key }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {form.result === 'fail' && (
              <label className="drawer-field">
                <span className="drawer-label">Failure reason</span>
                <select
                  className="input"
                  value={form.failReason}
                  onChange={(e) => setForm((f) => ({ ...f, failReason: e.target.value }))}
                >
                  {FAIL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            )}
          </>
        )}
      </Drawer>

      <Drawer
        open={addOpen}
        title="Add prepared number"
        onClose={() => setAddOpen(false)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitAddPrepared}
              disabled={addSubmitting}
            >
              {addSubmitting ? 'Saving…' : 'Add to queue'}
            </button>
          </>
        )}
      >
        <p className="drawer-hint">
          Phone, telco, and remark only — device, slot, and proxy are set in <strong>Submit Result</strong>.
        </p>
        <div className="drawer-fields">
          <label className="drawer-field">
            <span className="drawer-label">Phone number</span>
            <input
              className="input font-mono"
              placeholder="e.g. +60123456789"
              value={addForm.phone}
              onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="drawer-field">
            <span className="drawer-label">Telco</span>
            <select
              className="input"
              value={normalizeTelco(addForm.telco)}
              onChange={(e) => setAddForm((f) => ({ ...f, telco: e.target.value }))}
            >
              {TELCO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {(site === 'all') && (
            <label className="drawer-field">
              <span className="drawer-label">Site</span>
              <select
                className="input"
                value={addForm.site_key}
                onChange={(e) => {
                  const site_key = e.target.value === 'pp' ? 'pp' : 'my';
                  setAddForm((f) => ({ ...f, site_key }));
                }}
              >
                <option value="my">{SITES.my.name}</option>
                <option value="pp">{SITES.pp.name}</option>
              </select>
            </label>
          )}
          <label className="drawer-field">
            <span className="drawer-label">Remark</span>
            <input
              className="input"
              placeholder="Optional note"
              value={addForm.note}
              onChange={(e) => setAddForm((f) => ({ ...f, note: e.target.value }))}
            />
          </label>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!deleteConfirm}
        title={deleteConfirm?.title || 'Delete?'}
        message={deleteConfirm?.message || ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmDeletePrepared}
        onCancel={() => !deleting && setDeleteConfirm(null)}
      />

      <Toast open={!!toast} message={toast} onClose={() => setToast('')} />
    </div>
  );
}
