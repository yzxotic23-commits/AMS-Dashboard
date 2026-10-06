import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHead from '../../components/PageHead';
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

function toDraft(config) {
  return {
    enabled: Boolean(config?.enabled),
    entries: (config?.entries || []).map((e) => ({ value: e.value, label: e.label || '' })),
  };
}

export default function NetworkAccessPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ enabled: false, entries: [] });
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('default');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['settings', 'ip-allowlist'],
    queryFn: async () => (await api.get('/settings/ip-allowlist')).data,
  });

  useEffect(() => {
    if (data?.config) setDraft(toDraft(data.config));
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (body) => api.put('/settings/ip-allowlist', body).then((r) => r.data),
    onSuccess: (res) => {
      qc.setQueryData(['settings', 'ip-allowlist'], res);
      setToastTone('default');
      setToast(res.config.enabled ? 'Allowlist saved — only listed networks can use AMS' : 'Allowlist saved (off)');
    },
    onError: (err) => {
      setToastTone('error');
      setToast(err.message || 'Save failed');
    },
  });

  const yourIp = data?.your_ip || '';
  const cleaned = draft.entries
    .map((e) => ({ value: e.value.trim(), label: e.label.trim() }))
    .filter((e) => e.value);
  const invalid = cleaned.filter((e) => !IP_OR_CIDR.test(e.value)).map((e) => e.value);
  const hasYourIp = cleaned.some((e) => entryCoversIp(e.value, yourIp));
  const dirty = JSON.stringify({ enabled: draft.enabled, entries: cleaned })
    !== JSON.stringify(toDraft(data?.config));

  function patchEntry(i, patch) {
    setDraft((d) => ({ ...d, entries: d.entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) }));
  }

  function addEntry(value = '', label = '') {
    setDraft((d) => ({ ...d, entries: [...d.entries, { value, label }] }));
  }

  function removeEntry(i) {
    setDraft((d) => ({ ...d, entries: d.entries.filter((_, idx) => idx !== i) }));
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
        <div className="card max-w-3xl space-y-5 p-5">
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
              onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            />
            <span className={`toggle-track ${draft.enabled ? 'toggle-on' : ''}`}>
              <span className="toggle-thumb" />
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ams-surface-muted px-3 py-2 text-[13px]">
            <span className="text-ams-muted">
              Your current IP: <span className="font-mono font-semibold text-ams-ink">{yourIp || 'unknown'}</span>
              {hasYourIp && <span className="ml-2 text-ams-success">in list</span>}
            </span>
            {yourIp && !hasYourIp && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addEntry(yourIp, 'This office')}>
                <Plus size={14} strokeWidth={2.25} />
                Add my IP
              </button>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="drawer-label">Allowed IPs</span>
              <span className="text-[12px] text-ams-faint">Single IP (203.0.113.10) or range (203.0.113.0/24)</span>
            </div>
            {draft.entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ams-line px-3 py-5 text-center text-[13px] text-ams-faint">
                No IPs yet. Add each office / site public IP.
              </p>
            ) : (
              <ul className="space-y-2">
                {draft.entries.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input
                      className={`input w-56 font-mono${e.value.trim() && !IP_OR_CIDR.test(e.value.trim()) ? ' border-ams-danger' : ''}`}
                      placeholder="203.0.113.10"
                      value={e.value}
                      onChange={(ev) => patchEntry(i, { value: ev.target.value })}
                    />
                    <input
                      className="input flex-1"
                      placeholder="Label (e.g. Poipet office)"
                      value={e.label}
                      maxLength={80}
                      onChange={(ev) => patchEntry(i, { label: ev.target.value })}
                    />
                    <IconTooltip label="Remove">
                      <button
                        type="button"
                        className="table-icon-btn table-icon-btn--danger"
                        aria-label="Remove IP"
                        onClick={() => removeEntry(i)}
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </IconTooltip>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => addEntry()}>
              <Plus size={14} strokeWidth={2.25} />
              Add IP
            </button>
          </div>

          {draft.enabled && yourIp && !hasYourIp && (
            <p className="text-[12.5px] text-ams-danger">
              Your current IP is not in the list — saving would lock you out, so it will be refused.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-ams-line pt-4">
            <p className="text-[12px] text-ams-faint">
              Changes apply within 30 seconds. Every change is recorded in the Audit log.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!dirty || invalid.length > 0 || saveMut.isPending}
              onClick={() => saveMut.mutate({ enabled: draft.enabled, entries: cleaned })}
            >
              <Save size={15} strokeWidth={2.25} />
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <Toast open={!!toast} message={toast} tone={toastTone} onClose={() => setToast('')} />
    </div>
  );
}
