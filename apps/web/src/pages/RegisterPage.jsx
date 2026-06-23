import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import ConfirmDialog from '../components/ConfirmDialog';
import IconTooltip from '../components/IconTooltip';
import Toast from '../components/Toast';
import { useSite } from '../context/SiteContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { serializeAccountNotes } from '../lib/account-operator-meta';
import { inferBrandFromDevice } from '../lib/account-status-labels';
import { useOperatorRoster, operatorDisplayName } from '../hooks/useOperatorRoster';
import { useAccountMutations } from '../hooks/useOperatorAccounts';
import { useRegistrationStats, useRegistrationLog } from '../hooks/useRegistrationStats';
import { useFreeIps, useDeviceOptions, useSimOptions } from '../hooks/useResourceOptions';
import { matchSimIdForPrepared } from '../lib/resource-mappers';
import {
  DEVICE_CHANNEL_SLOTS,
  formatDeviceOptionLabel,
  normalizeDeviceChannel,
} from '../lib/device-location';
import { useAllAccounts } from '../hooks/useOperatorAccounts';
import { toastCopy } from '../lib/operator-copy';
import { dismissPreparedRow, usePreparedQueue, addPreparedNumber, deletePreparedNumber } from '../hooks/usePreparedQueue';

const FAIL_REASONS = ['Number rejected', 'IP flagged', 'No verification code', 'Other'];
const TELCO_OPTIONS = ['Outsource', 'Tunetalk', 'Celcom', 'Digi', 'Maxis', 'U Mobile'];
const TABS = [
  { id: 'prepared', label: 'Prepared Numbers' },
  { id: 'log', label: 'Registration Log' },
];

function NeedBadge({ need }) {
  if (!need) return <span className="badge badge-default">Not required</span>;
  return <span className="badge badge-warn">Required</span>;
}

export default function RegisterPage() {
  const { site } = useSite();
  const qc = useQueryClient();
  const { data: rows = { my: [], pp: [] }, isLoading: queueLoading } = usePreparedQueue(site);
  const [drawer, setDrawer] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    phone: '',
    telco: TELCO_OPTIONS[0],
    site_key: 'my',
    note: '',
    need: true,
  });
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [form, setForm] = useState({
    deviceId: '', slot: DEVICE_CHANNEL_SLOTS[0], ipId: '', accountName: '', owner: '', result: 'ok', failReason: FAIL_REASONS[0],
  });
  const { data: operators = [] } = useOperatorRoster();
  const defaultOperator = operators[0] ? operatorDisplayName(operators[0]) : '';
  const { data: ledgerAccounts = [] } = useAllAccounts();
  const [toast, setToast] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState('prepared');
  const { createAccount, logRegistration } = useAccountMutations();
  const { data: regStats } = useRegistrationStats(site);
  const { data: regLog = [] } = useRegistrationLog(15);

  const siteKey = drawer?.siteKey || 'my';
  const freeIps = useFreeIps(siteKey);
  const devices = useDeviceOptions(siteKey);
  const sims = useSimOptions(siteKey);

  const availableSlots = useMemo(() => {
    if (!form.deviceId) return DEVICE_CHANNEL_SLOTS;
    const taken = new Set(
      ledgerAccounts
        .filter((a) => a.device_id === form.deviceId)
        .map((a) => normalizeDeviceChannel(a.channel)),
    );
    return DEVICE_CHANNEL_SLOTS.filter((slot) => !taken.has(slot));
  }, [form.deviceId, ledgerAccounts]);

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
    setAddForm({
      phone: '',
      telco: TELCO_OPTIONS[0],
      site_key: site === 'all' ? 'my' : site,
      note: '',
      need: true,
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
      await addPreparedNumber({
        phone_number: phone,
        telco: addForm.telco,
        site_key: addForm.site_key,
        note: addForm.note.trim() || null,
        need: addForm.need,
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
    const deviceId = devices[0]?.id || '';
    const slot = DEVICE_CHANNEL_SLOTS[0];
    setForm({
      deviceId,
      slot,
      ipId: freeIps.find((ip) => (ip.in_use ?? 0) === 0)?.id || '',
      accountName: '',
      owner: ownerForDeviceSlot(),
      result: 'ok',
      failReason: FAIL_REASONS[0],
    });
    setDrawer(row);
  }

  async function submitReg() {
    if (!drawer || submitting) return;
    setSubmitting(true);
    try {
      if (form.result === 'ok') {
        const simId = matchSimIdForPrepared(drawer.phone, drawer.telco, sims) || drawer.id;
        const ipRow = freeIps.find((ip) => ip.id === form.ipId);
        const deviceRow = devices.find((d) => d.id === form.deviceId);
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
        });
        qc.invalidateQueries({ queryKey: ['accounts'] });
        qc.invalidateQueries({ queryKey: ['ips'] });
        qc.invalidateQueries({ queryKey: ['registrations'] });
        await dismissPreparedRow(drawer.id, { need: false });
        setToast(toastCopy.registerOk(drawer.phone, form.accountName));
      } else {
        await logRegistration.mutateAsync({
          phone_number: drawer.phone,
          telco: drawer.telco,
          site_key: drawer.siteKey,
          result: 'fail',
          fail_reason: form.failReason,
          device_id: form.deviceId || null,
          ip_id: form.ipId || null,
          remark: drawer.note || null,
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
        description="Numbers are pre-provisioned in bulk. Successful registration creates a REGISTERING account and sends it to Activation for engine linking."
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
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Phone</th>
                <th>Result</th>
                <th>Reason / Account</th>
                <th>Operator</th>
              </tr>
            </thead>
            <tbody>
              {regLog.length === 0 ? (
                <tr><td colSpan={5} className="empty-cell">No registration attempts logged yet.</td></tr>
              ) : regLog.map((row) => (
                <tr key={row.id}>
                  <td className="col-mono col-muted whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="col-mono">{row.phone_number}</td>
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
            <button type="button" className="btn btn-primary" onClick={submitReg} disabled={submitting}>
              {submitting ? 'Saving…' : 'Submit Result'}
            </button>
          </>
        )}
      >
        {drawer && (
          <>
            <p className="drawer-hint">
              Successful registration creates the account in Activation queue (REGISTERING). Device farm phase starts after engine link.
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Prepared number · Telco</div>
              <div className="drawer-locked-value drawer-locked-value--mono">
                {drawer.phone}
                <span className="drawer-locked-meta">{drawer.telco}</span>
              </div>
            </div>
            <div className="drawer-fields">
              <label className="drawer-field">
                <span className="drawer-label">Register to device</span>
                <select
                  className="input font-mono"
                  value={form.deviceId}
                  onChange={(e) => {
                    const deviceId = e.target.value;
                    const taken = new Set(
                      ledgerAccounts
                        .filter((a) => a.device_id === deviceId)
                        .map((a) => normalizeDeviceChannel(a.channel)),
                    );
                    const free = DEVICE_CHANNEL_SLOTS.filter((slot) => !taken.has(slot));
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
                  ) : devices.map((d) => (
                    <option key={d.id} value={d.id}>{formatDeviceOptionLabel(d)}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-ams-faint">
                  One device code holds up to 4 WA slots — e.g. MYR-SB-001 · Shelf A · Slot 1
                </span>
              </label>
              <label className="drawer-field">
                <span className="drawer-label">WA slot (max 4 per device)</span>
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
                    <option value="">All 4 slots occupied</option>
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
                >
                  {operators.length === 0 ? (
                    <option value="">No operators — add in User management</option>
                  ) : operators.map((op) => {
                    const label = operatorDisplayName(op);
                    return <option key={op.id} value={label}>{label}</option>;
                  })}
                </select>
                <span className="mt-1 block text-[11px] text-ams-faint">
                  Pipeline Control Center mengelompokkan akun per operator ini.
                </span>
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Assign IP (from IP ledger)</span>
                <select
                  className="input font-mono"
                  value={form.ipId}
                  onChange={(e) => setForm((f) => ({ ...f, ipId: e.target.value }))}
                >
                  {freeIps.map((ip) => (
                    <option key={ip.id} value={ip.id}>{ip.ip_address}</option>
                  ))}
                </select>
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Account name</span>
                <input
                  className="input"
                  placeholder="e.g. SBMY xxx"
                  value={form.accountName}
                  onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
                />
              </label>
            </div>
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
          Add a SIM number waiting for WhatsApp registration. Use Fill Result after the number is registered on device.
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
              value={addForm.telco}
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
                onChange={(e) => setAddForm((f) => ({ ...f, site_key: e.target.value }))}
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
          <label className="drawer-field flex-row items-center gap-3">
            <input
              type="checkbox"
              className="ams-check"
              checked={addForm.need}
              onChange={(e) => setAddForm((f) => ({ ...f, need: e.target.checked }))}
            />
            <span className="drawer-label mb-0">Needs registration</span>
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
