import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHead from '../../components/PageHead';
import ConfirmDialog from '../../components/ConfirmDialog';
import DetailDialog from '../../components/DetailDialog';
import IconTooltip from '../../components/IconTooltip';
import Toast from '../../components/Toast';
import api from '../../lib/api';

const IP_OR_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((acc, p) => ((acc << 8) + Number(p)) >>> 0, 0);
}

function entryCoversIp(entry, ip) {
  if (!ip) return false;
  const [addr, prefixRaw] = entry.split('/');
  if (prefixRaw === undefined) return addr === ip;
  const a = ipv4ToInt(addr);
  const b = ipv4ToInt(ip);
  const prefix = Number(prefixRaw);
  if (a == null || b == null || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (a & mask) === (b & mask);
}

const BASE_DEPARTMENTS = ['CRM', 'SSC'];
const OTHER = '__other__';

/** Base choices plus any department already used in the list, so existing labels stay selectable. */
function departmentOptionsFor(entries) {
  const used = entries.map((e) => e.department?.trim()).filter(Boolean);
  return [...new Set([...BASE_DEPARTMENTS, ...used])];
}

function toDraft(config) {
  return {
    enabled: Boolean(config?.enabled),
    entries: (config?.entries || []).map((e) => ({
      value: e.value,
      department: e.department || (e.user ? '' : e.label || ''),
      user: e.user || '',
      remark: e.remark || '',
      active: e.active !== false,
    })),
  };
}

let entryKeySeq = 0;
const withKey = (e) => ({ ...e, key: ++entryKeySeq });

export default function NetworkAccessPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ enabled: false, entries: [] });
  const [dialog, setDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('default');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['settings', 'ip-allowlist'],
    queryFn: async () => (await api.get('/settings/ip-allowlist')).data,
  });

  useEffect(() => {
    if (!data?.config) return;
    const next = toDraft(data.config);
    setDraft({ ...next, entries: next.entries.map(withKey) });
  }, [data]);

  const saveMut = useMutation({
    mutationFn: ({ body }) => api.put('/settings/ip-allowlist', body).then((r) => r.data),
    onSuccess: (res, { message }) => {
      qc.setQueryData(['settings', 'ip-allowlist'], res);
      setToastTone('default');
      setToast(message);
    },
    onError: (err) => {
      setToastTone('error');
      setToast(err.message || 'Save failed');
    },
  });

  const yourIp = data?.your_ip || '';
  const hasYourIp = draft.entries.some((e) => e.active && entryCoversIp(e.value, yourIp));

  function persist(next, message, onSaved) {
    const entries = next.entries.map(({ key: _key, ...e }) => e);
    saveMut.mutate({ body: { enabled: next.enabled, entries }, message }, { onSuccess: onSaved });
  }

  function setEnabled(enabled) {
    persist(
      { ...draft, enabled },
      enabled ? 'Allowlist on — only active IPs in the list can use AMS' : 'Allowlist off — AMS is reachable from any network',
      () => setConfirm(null),
    );
  }

  function openAdd(value = '') {
    setDialog({ key: null, customDept: false, form: { value, department: 'CRM', user: '', remark: '', active: true } });
  }

  function openEdit(entry) {
    const { key, ...form } = entry;
    setDialog({ key, customDept: false, form });
  }

  function patchForm(patch) {
    setDialog((d) => (d ? { ...d, form: { ...d.form, ...patch } } : d));
  }

  function removeEntry(entry) {
    persist(
      { ...draft, entries: draft.entries.filter((e) => e.key !== entry.key) },
      `${entry.value} removed`,
      () => setConfirm(null),
    );
  }

  const formValue = dialog?.form.value.trim() || '';
  const formError = !dialog ? null
    : !formValue ? 'IP address is required'
      : !IP_OR_CIDR.test(formValue) ? 'Not a valid IP or range'
        : draft.entries.some((e) => e.key !== dialog.key && e.value.trim() === formValue) ? 'This IP is already in the list'
          : !dialog.form.department.trim() ? 'Department is required'
            : null;
  const departmentOptions = departmentOptionsFor(draft.entries);

  function submitDialog(ev) {
    ev.preventDefault();
    if (!dialog || formError) return;
    const form = Object.fromEntries(
      Object.entries(dialog.form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
    );
    const entries = dialog.key == null
      ? [...draft.entries, form]
      : draft.entries.map((e) => (e.key === dialog.key ? { ...e, ...form } : e));
    persist(
      { ...draft, entries },
      dialog.key == null ? `${form.value} added` : `${form.value} updated`,
      () => setDialog(null),
    );
  }

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ams-faint">Settings</p>
      <PageHead
        title="Network access"
        description="Restrict AMS to the company network. When on, every request from an IP outside this list is refused — including login."
      />

      {isLoading && <div className="py-12 text-center text-sm text-ams-muted">Loading…</div>}
      {isError && (
        <div className="card px-5 py-4 text-sm text-ams-danger">Could not load settings — {error?.message}</div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="card space-y-4 p-5">
            {data.bypass_active && (
              <div className="rounded-lg border border-ams-warn/40 bg-ams-warn/10 px-3 py-2 text-[13px] text-ams-ink">
                Emergency bypass is on (<code className="font-mono">IP_ALLOWLIST_BYPASS=1</code>) — the allowlist is not enforced until it is removed from the server environment.
              </div>
            )}

            <label className="flex cursor-pointer items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold text-ams-ink">Only allow the company network</span>
                <span className="block text-[12.5px] text-ams-muted">
                  {draft.enabled ? 'On — IPs outside the list are blocked.' : 'Off — AMS is reachable from any network.'}
                </span>
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={draft.enabled}
                disabled={saveMut.isPending}
                onChange={(e) => (e.target.checked ? setConfirm({ kind: 'enable' }) : setEnabled(false))}
              />
              <span className={`toggle-track ${draft.enabled ? 'toggle-on' : ''}`}>
                <span className="toggle-thumb" />
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ams-surface-muted px-3 py-2 text-[13px]">
              <span className="text-ams-muted">
                Your current IP: <span className="font-mono font-semibold text-ams-ink">{yourIp || 'unknown'}</span>
                {yourIp && (hasYourIp
                  ? <span className="badge badge-success ml-2">In list</span>
                  : <span className="badge badge-danger ml-2">Not in list</span>)}
              </span>
              {yourIp && !hasYourIp && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openAdd(yourIp)}>
                  <Plus size={14} strokeWidth={2.25} />
                  Add my IP
                </button>
              )}
            </div>

            {!draft.enabled && yourIp && !hasYourIp && (
              <p className="text-[12.5px] text-ams-muted">
                Add your current IP as an active entry before turning this on — otherwise it will be refused so you are not locked out.
              </p>
            )}
            {draft.enabled && yourIp && !hasYourIp && (
              <p className="text-[12.5px] text-ams-danger">
                Your current IP is not in the active list — requests from this network are blocked.
              </p>
            )}
          </div>

          <div className="data-panel card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ams-line px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ams-ink">Allowed IPs</span>
                <span className="badge badge-default">{draft.entries.length}</span>
                <span className="hidden text-[12px] text-ams-faint sm:inline">
                  Single IP (203.0.113.10) or range (203.0.113.0/24)
                </span>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAdd()}>
                <Plus size={14} strokeWidth={2.25} />
                Add IP
              </button>
            </div>

            <div className="data-table-wrap">
              <table className="data-table data-table--allowlist w-full">
                <thead>
                  <tr>
                    <th className="col-num">#</th>
                    <th className="col-ip">IP address</th>
                    <th className="col-department">Department</th>
                    <th className="col-user">User</th>
                    <th className="col-status">Status</th>
                    <th className="col-note">Remark</th>
                    <th className="col-action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.entries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-cell">No IPs yet. Add each office / VPN public IP.</td>
                    </tr>
                  ) : draft.entries.map((e, i) => {
                    const value = e.value.trim();
                    const bad = value && !IP_OR_CIDR.test(value);
                    const coversYou = value && entryCoversIp(value, yourIp);
                    return (
                      <tr key={e.key} className={e.active ? undefined : 'is-inactive'}>
                        <td className="col-num">{i + 1}</td>
                        <td className="col-ip">
                          <span className="flex items-center gap-2">
                            <span className={`font-mono ${bad ? 'text-ams-danger' : 'text-ams-ink'}`}>{e.value}</span>
                            {coversYou && <span className="badge badge-success">Your IP</span>}
                          </span>
                        </td>
                        <td className="col-department">
                          {e.department
                            ? <span className="font-medium text-ams-ink">{e.department}</span>
                            : <span className="text-ams-faint">—</span>}
                        </td>
                        <td className="col-user">{e.user || <span className="text-ams-faint">—</span>}</td>
                        <td className="col-status">
                          {e.active
                            ? <span className="badge badge-success">Active</span>
                            : <span className="badge badge-default">Non Active</span>}
                        </td>
                        <td className="col-note">
                          {e.remark
                            ? <span className="block truncate text-ams-muted" title={e.remark}>{e.remark}</span>
                            : <span className="text-ams-faint">—</span>}
                        </td>
                        <td className="col-action">
                          <div className="col-action-btns">
                            <IconTooltip label="Edit">
                              <button
                                type="button"
                                className="table-icon-btn"
                                aria-label="Edit IP"
                                onClick={() => openEdit(e)}
                              >
                                <Pencil size={15} strokeWidth={2} />
                              </button>
                            </IconTooltip>
                            <IconTooltip label="Remove">
                              <button
                                type="button"
                                className="table-icon-btn table-icon-btn--danger"
                                aria-label="Remove IP"
                                onClick={() => setConfirm({ kind: 'remove', entry: e })}
                              >
                                <Trash2 size={15} strokeWidth={2} />
                              </button>
                            </IconTooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="border-t border-ams-line px-5 py-3 text-[12px] text-ams-faint">
              Changes are saved immediately and apply within 30 seconds. Every change is recorded in the Audit log.
            </p>
          </div>
        </div>
      )}

      <DetailDialog
        open={!!dialog}
        title={dialog?.key == null ? 'Add IP' : `Edit IP · ${dialog?.form.value || ''}`}
        onClose={() => setDialog(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="submit"
              form="allowlist-form"
              className="btn btn-primary btn-sm"
              disabled={!!formError || saveMut.isPending}
            >
              {saveMut.isPending ? 'Saving…' : dialog?.key == null ? 'Add IP' : 'Save changes'}
            </button>
          </>
        )}
      >
        {dialog && (
          <form id="allowlist-form" onSubmit={submitDialog} className="drawer-fields">
            <div className="grid grid-cols-3 items-start gap-3">
              <label className="drawer-field col-span-2">
                <span className="drawer-label">IP address</span>
                <input
                  className={`input font-mono${formValue && formError === 'Not a valid IP or range' ? ' border-ams-danger' : ''}`}
                  placeholder="203.0.113.10 or 203.0.113.0/24"
                  value={dialog.form.value}
                  onChange={(ev) => patchForm({ value: ev.target.value })}
                  autoFocus
                  required
                />
                {formValue && formError && formError !== 'Department is required' && (
                  <span className="drawer-hint text-ams-danger">{formError}</span>
                )}
              </label>
              <label className="drawer-field">
                <span className="drawer-label">Status</span>
                <select
                  className="input"
                  value={dialog.form.active ? 'active' : 'inactive'}
                  onChange={(ev) => patchForm({ active: ev.target.value === 'active' })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Non Active</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 items-start gap-3">
              <label className="drawer-field">
                <span className="drawer-label">Department</span>
                <select
                  className="input"
                  value={dialog.customDept ? OTHER : dialog.form.department}
                  onChange={(ev) => {
                    const custom = ev.target.value === OTHER;
                    setDialog((d) => ({ ...d, customDept: custom, form: { ...d.form, department: custom ? '' : ev.target.value } }));
                  }}
                >
                  {departmentOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  <option value={OTHER}>Other…</option>
                </select>
                {dialog.customDept && (
                  <input
                    className="input mt-2"
                    placeholder="Department name"
                    value={dialog.form.department}
                    maxLength={40}
                    onChange={(ev) => patchForm({ department: ev.target.value })}
                    autoFocus
                  />
                )}
              </label>
              <label className="drawer-field">
                <span className="drawer-label">User</span>
                <input
                  className="input"
                  placeholder="e.g. SGD 1"
                  value={dialog.form.user}
                  maxLength={60}
                  onChange={(ev) => patchForm({ user: ev.target.value })}
                />
              </label>
            </div>

            <label className="drawer-field">
              <span className="drawer-label">Remark <span className="font-normal text-ams-faint">(optional)</span></span>
              <textarea
                className="input min-h-[4.5rem] resize-y py-2"
                placeholder="e.g. Emergency backup — use only if VPN 1 and 2 are down"
                value={dialog.form.remark}
                maxLength={200}
                onChange={(ev) => patchForm({ remark: ev.target.value })}
              />
            </label>

            <p className="drawer-hint">Saved immediately — applies within 30 seconds.</p>
          </form>
        )}
      </DetailDialog>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'enable' ? 'Turn on the network allowlist?' : `Remove ${confirm?.entry?.value}?`}
        message={confirm?.kind === 'enable'
          ? 'Only active IPs in this list will be able to open AMS — everyone else is blocked, including login.'
          : `${[confirm?.entry?.department, confirm?.entry?.user].filter(Boolean).join(' · ') || 'This IP'} will no longer be able to open AMS once the allowlist is on.`}
        confirmLabel={confirm?.kind === 'enable' ? 'Turn on' : 'Remove'}
        danger={confirm?.kind === 'remove'}
        onConfirm={() => (confirm?.kind === 'enable' ? setEnabled(true) : removeEntry(confirm.entry))}
        onCancel={() => setConfirm(null)}
      />

      <Toast open={!!toast} message={toast} tone={toastTone} onClose={() => setToast('')} />
    </div>
  );
}
