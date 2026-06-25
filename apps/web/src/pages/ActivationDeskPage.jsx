import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Zap } from 'lucide-react';
import PageHead from '../components/PageHead';
import LinkWhatsAppDrawer from '../components/LinkWhatsAppDrawer';
import EngineSlotSelect from '../components/EngineSlotSelect';
import NurturingPanels from '../components/NurturingPanels';
import Toast from '../components/Toast';
import api from '../lib/api';
import { useSite } from '../context/SiteContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useEngineBridgeStatus } from '../hooks/useBridgeConnect';
import { useAccountsByStatus, useAccountMutations, useAllAccounts } from '../hooks/useOperatorAccounts';
import { useFreeIps, useDeviceOptions, useSimOptions } from '../hooks/useResourceOptions';
import { toastCopy } from '../lib/operator-copy';
import {
  isAutoGraduationDue, isManualScanDue,
} from '../lib/nurturing-day';

const ACTIVATION_STEPS = ['sim', 'device', 'ip', 'phone', 'slot', 'linked'];

const PAGE_TABS = [
  { id: 'activation', label: 'Activation' },
  { id: 'nurturing', label: 'Nurturing' },
];

function checklist(account, engineSlots) {
  const slot = account.wsaf_slot;
  const engine = slot != null
    ? (engineSlots || []).find((s) => s.slot === slot)
    : null;
  return {
    sim: !!(account.sim_id || account.sim),
    device: !!(account.device_id || account.device),
    ip: !!(account.ip_id || account.ip),
    phone: !!(account.phone_number && account.phone_number.trim()),
    slot: slot != null,
    linked: account.linked_override || !!(engine && engine.connected),
  };
}

function stepProgress(c) {
  const done = ACTIVATION_STEPS.filter((k) => c[k]).length;
  return {
    done,
    total: ACTIVATION_STEPS.length,
    pct: Math.round((done / ACTIVATION_STEPS.length) * 100),
  };
}

function missingSteps(c) {
  if (!c) return [];
  const labels = {
    sim: 'SIM',
    device: 'Device',
    ip: 'IP',
    phone: 'Phone',
    slot: 'Engine slot',
    linked: 'WhatsApp linked',
  };
  return Object.keys(labels).filter((k) => !c[k]).map((k) => labels[k]);
}

function StepCard({ title, done, children }) {
  return (
    <div className={`activation-step${done ? ' activation-step--done' : ''}`}>
      <div className="activation-step-title">{title}</div>
      {children}
    </div>
  );
}

function LockedField({ label, value, mono }) {
  return (
    <div className="drawer-locked">
      <div className="drawer-locked-label">{label}</div>
      <div className={`drawer-locked-value${mono ? ' drawer-locked-value--mono' : ''}`}>{value}</div>
    </div>
  );
}

export default function ActivationDeskPage() {
  const { site } = useSite();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'nurturing' ? 'nurturing' : 'activation';
  const [selectedId, setSelectedId] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: queue = [], isLoading } = useAccountsByStatus('REGISTERING');
  const { data: nurturing = [] } = useAccountsByStatus('NURTURING');
  const { data: allAccounts = [] } = useAllAccounts();
  const { patchAccount, transitionAccount, invalidate } = useAccountMutations();
  const { data: engineStatus, refetch: refetchEngine } = useEngineBridgeStatus();

  const engineReachable = engineStatus?.reachable !== false && engineStatus?.ok !== false;
  const engineSlots = engineStatus?.accounts || engineStatus?.slots || [];

  const list = useMemo(() => {
    if (site === 'all') return queue;
    return queue.filter((r) => r.siteKey === site);
  }, [queue, site]);

  const account = list.find((a) => a.id === selectedId);

  const slotTakenBy = useMemo(() => {
    const map = {};
    allAccounts.forEach((a) => {
      if (a.wsaf_slot == null || a.id === account?.id) return;
      map[a.wsaf_slot] = a.account_name;
    });
    return map;
  }, [allAccounts, account?.id]);
  const resourceSite = account?.siteKey || 'my';
  const devices = useDeviceOptions(resourceSite);
  const sims = useSimOptions(resourceSite);
  const freeIps = useFreeIps(resourceSite);
  const ipOptions = freeIps;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3800);
  };

  async function savePatch(id, row, patch) {
    const extra = {};
    if ('phone_number' in patch) extra.phone_number = patch.phone_number;
    if ('wsaf_slot' in patch) extra.wsaf_slot = patch.wsaf_slot;
    try {
      await patchAccount.mutateAsync({ id, row, patch, extra });
    } catch (e) {
      showToast(e.message || 'Could not save changes');
      throw e;
    }
  }

  async function changeEngineSlot(slot) {
    if (!account) return;
    if (slot != null && slotTakenBy[slot]) {
      showToast(`Slot ${slot + 1} is already used by ${slotTakenBy[slot]}`);
      return;
    }
    await savePatch(account.id, account, { wsaf_slot: slot });
  }

  const c = account ? checklist(account, engineSlots) : null;
  const steps = c ? stepProgress(c) : { done: 0, total: ACTIVATION_STEPS.length, pct: 0 };

  const nurturingStats = useMemo(() => {
    const scoped = site === 'all' ? nurturing : nurturing.filter((r) => r.siteKey === site);
    const manual = scoped.filter((r) => r.nurturing_phase === 'manual');
    const auto = scoped.filter((r) => r.nurturing_phase === 'auto');
    const scanReady = manual.filter(isManualScanDue).length;
    const gradReady = auto.filter(isAutoGraduationDue).length;
    return {
      active: scoped.length,
      manual: manual.length,
      auto: auto.length,
      scanReady,
      gradReady,
    };
  }, [nurturing, site]);

  const readyCount = list.filter((a) => {
    const ch = checklist(a, engineSlots);
    return ch.sim && ch.device && ch.ip && ch.phone && ch.slot;
  }).length;

  const linkedCount = list.filter((a) => checklist(a, engineSlots).linked).length;

  function setTab(nextTab) {
    if (nextTab === 'nurturing') {
      setSearchParams({ tab: 'nurturing' }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  async function markAsLinked() {
    if (!account || busy) return;
    setBusy(true);
    try {
      await patchAccount.mutateAsync({
        id: account.id,
        row: account,
        patch: { linked_override: true },
      });
      showToast(toastCopy.activationLinked(account.account_name));
    } catch (e) {
      showToast(e.message || 'Could not save link status');
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!account || busy) return;
    setBusy(true);
    try {
      await patchAccount.mutateAsync({
        id: account.id,
        row: account,
        patch: {
          nurturing_phase: 'manual',
          nurturing_started_at: new Date().toISOString(),
        },
      });
      await transitionAccount.mutateAsync({
        id: account.id,
        to_status: 'NURTURING',
        reason: 'Activated for nurturing',
      });
      invalidate();
      setSelectedId(null);
      setTab('nurturing');
      showToast(toastCopy.activationDone(account.account_name));
    } catch (e) {
      showToast(e.message || 'Activation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Activation & Nurturing"
        description="Link WhatsApp after register, then track device farm (days 1–3) and engine nurturing (days 4–7) from one desk."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-accent">{list.length}</span>
            <span>activation</span>
            <span className="text-ams-faint">·</span>
            <span>{linkedCount} linked</span>
            <span className="text-ams-faint">·</span>
            <span className="font-semibold text-ams-accent">{nurturingStats.active}</span>
            <span>nurturing</span>
            {nurturingStats.scanReady > 0 && (
              <>
                <span className="text-ams-faint">·</span>
                <span className="font-semibold text-ams-warn">{nurturingStats.scanReady}</span>
                <span>scan-in</span>
              </>
            )}
            {nurturingStats.gradReady > 0 && (
              <>
                <span className="text-ams-faint">·</span>
                <span className="font-semibold text-ams-success">{nurturingStats.gradReady}</span>
                <span>day 7</span>
              </>
            )}
          </div>
        )}
      />

      <div className="tk-tab-toolbar mb-4">
        <div className="page-tab-bar tk-tab-toolbar-tabs" role="tablist" aria-label="Activation desk sections">
          {PAGE_TABS.map(({ id, label }) => {
            const active = tab === id;
            const badge = id === 'activation'
              ? (list.length > 0 ? list.length : null)
              : (nurturingStats.active > 0 ? nurturingStats.active : null);
            const badgeWarn = id === 'activation'
              ? list.length > 0
              : nurturingStats.scanReady > 0;
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
                  <span className={`page-tab-badge${badgeWarn ? ' page-tab-badge--warn' : ''}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'activation' && !engineReachable && (
        <div className="mb-4 rounded-lg border border-ams-warn/40 bg-ams-warn/10 px-4 py-3 text-[13px] text-ams-warn">
          FeedFlow engine is offline — WhatsApp linking will fail until the engine is running on port 47821.
          {engineStatus?.error ? ` (${engineStatus.error})` : ''}
          {' '}Restart <span className="font-mono">npm run dev</span> in the AMS Project folder.
        </div>
      )}

      {tab === 'activation' && (
      <div className="activation-stats">
        <div className="activation-stat">
          <div className="activation-stat-val">{list.length}</div>
          <div className="activation-stat-label">Pending</div>
        </div>
        <div className="activation-stat">
          <div className="activation-stat-val text-ams-warn">{readyCount}</div>
          <div className="activation-stat-label">Ready to link</div>
        </div>
        <div className="activation-stat">
          <div className="activation-stat-val text-ams-success">{linkedCount}</div>
          <div className="activation-stat-label">Linked</div>
        </div>
      </div>
      )}

      {tab === 'activation' && (
      <div className="activation-layout">
        <div className="data-panel card overflow-hidden">
          <div className="border-b border-ams-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ams-ink">Activation queue</h3>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Progress</th>
                  {site === 'all' && <th>Site</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={site === 'all' ? 4 : 3} className="empty-cell">Loading…</td></tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={site === 'all' ? 4 : 3} className="empty-cell">
                      No accounts awaiting activation. Register a number first.
                    </td>
                  </tr>
                ) : list.map((row) => {
                  const ch = checklist(row, engineSlots);
                  const sp = stepProgress(ch);
                  const linked = ch.linked;
                  return (
                    <tr
                      key={row.id}
                      className={selectedId === row.id ? 'row-selected' : ''}
                      onClick={() => setSelectedId(row.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setSelectedId(row.id)}
                    >
                      <td className="font-semibold text-ams-blue">{row.account_name}</td>
                      <td>
                        <div className="nurt-progress">
                          <div className="nurt-progress-track">
                            <div className="nurt-progress-fill nurt-progress-fill--warn" style={{ width: `${sp.pct}%` }} />
                          </div>
                          <span className="nurt-progress-label">Step {sp.done}/{sp.total}</span>
                        </div>
                      </td>
                      {site === 'all' && (
                        <td><span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span></td>
                      )}
                      <td>
                        <span className={`badge ${linked ? 'badge-success' : 'badge-warn'}`}>
                          {linked ? 'Linked' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card activation-wizard">
          {!account ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <Zap size={28} className="mb-3 text-ams-faint" />
              <p className="text-sm text-ams-muted">Select an account from the queue</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-ams-line px-4 py-3">
                <h3 className="text-sm font-semibold text-ams-ink">{account.account_name}</h3>
                <span className="badge badge-accent">Step {steps.done}/{steps.total}</span>
              </div>
              <div className="space-y-3 p-4">
                <StepCard title="1. Resources" done={c.sim && c.device && c.ip}>
                  <p className="mb-2 text-[11px] text-ams-muted">
                    Assigned at Register — synced from account record.
                  </p>
                  <div className="activation-fields">
                    {account.sim ? (
                      <LockedField label="SIM · Telco" value={account.sim} />
                    ) : (
                      <select
                        className="input text-sm"
                        value={account.sim_id || ''}
                        onChange={(e) => savePatch(account.id, account, {
                          sim_id: e.target.value || null,
                        })}
                      >
                        <option value="">— SIM —</option>
                        {sims.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    )}
                    {account.device_id ? (
                      <LockedField label="Device" value={account.device} mono />
                    ) : (
                      <select
                        className="input text-sm font-mono"
                        value={account.device_id || ''}
                        onChange={(e) => savePatch(account.id, account, {
                          device_id: e.target.value || null,
                        })}
                      >
                        <option value="">— Device —</option>
                        {devices.map((d) => {
                          const unavailable = d.status && d.status !== 'ACTIVE' && d.id !== account.device_id;
                          return (
                            <option key={d.id} value={d.id} disabled={unavailable}>
                              {d.device_name}{unavailable ? ` (${d.status})` : ''}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    {account.ip_id ? (
                      <LockedField label="IP" value={account.ip} mono />
                    ) : (
                      <select
                        className="input text-sm font-mono"
                        value={account.ip_id || ''}
                        onChange={(e) => savePatch(account.id, account, {
                          ip_id: e.target.value || null,
                        })}
                      >
                        <option value="">— IP —</option>
                        {ipOptions.map((ip) => {
                          const inUse = (ip.in_use ?? 0) > 0 && ip.id !== account.ip_id;
                          return (
                            <option key={ip.id} value={ip.id} disabled={inUse}>
                              {ip.ip_address}{inUse ? ' (in use)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    {account.channel ? (
                      <LockedField label="Channel" value={account.channel} />
                    ) : null}
                  </div>
                </StepCard>

                <StepCard title="2. Phone" done={c.phone}>
                  {account.phone_number ? (
                    <LockedField label="Prepared number" value={account.phone_number} mono />
                  ) : (
                    <input
                      className="input font-mono text-sm"
                      placeholder="+60…"
                      value={account.phone_number}
                      onChange={(e) => savePatch(account.id, account, { phone_number: e.target.value })}
                    />
                  )}
                </StepCard>

                <StepCard title="3. Engine slot" done={c.slot}>
                  <EngineSlotSelect
                    value={account.wsaf_slot}
                    engineSlots={engineSlots}
                    slotTakenBy={slotTakenBy}
                    onChange={changeEngineSlot}
                  />
                  {Object.keys(slotTakenBy).length > 0 && (
                    <p className="mt-1.5 text-[11px] text-ams-muted">
                      Slots marked with an account name are already assigned elsewhere.
                    </p>
                  )}
                </StepCard>

                <StepCard title="4. Link WhatsApp" done={c.linked}>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm w-full"
                      disabled={account.wsaf_slot == null || c.linked}
                      title={
                        c.linked
                          ? 'WhatsApp is already linked'
                          : account.wsaf_slot == null
                            ? 'Assign an engine slot first (step 3)'
                            : 'Open the link panel to scan QR or use a pairing code'
                      }
                      onClick={() => setLinkOpen(true)}
                    >
                      {c.linked ? 'WhatsApp linked' : 'Link WhatsApp in AMS'}
                    </button>
                    {c.linked && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm w-full text-[12px]"
                        disabled={busy}
                        onClick={() => setLinkOpen(true)}
                      >
                        Re-link WhatsApp
                      </button>
                    )}
                    {account.wsaf_slot == null && !c.linked && (
                      <p className="text-[11px] text-ams-muted">
                        Pick an engine slot in step 3 before linking.
                      </p>
                    )}
                    {account.wsaf_slot != null && !engineReachable && !c.linked && (
                      <p className="text-[11px] text-ams-warn">
                        Engine offline — you can still open the link panel; AMS will try to start FeedFlow.
                      </p>
                    )}
                    {!c.linked && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm w-full text-[12px]"
                        disabled={account.wsaf_slot == null || busy}
                        title={
                          account.wsaf_slot == null
                            ? 'Assign an engine slot first'
                            : 'Use only if you linked on the phone without QR in AMS'
                        }
                        onClick={markAsLinked}
                      >
                        Linked on phone — mark complete
                      </button>
                    )}
                  </div>
                </StepCard>

                <button
                  type="button"
                  className="btn btn-primary flex w-full items-center justify-center gap-2"
                  disabled={steps.pct < 100 || busy}
                  title={steps.pct < 100 ? `Complete: ${missingSteps(c).join(', ')}` : ''}
                  onClick={activate}
                >
                  <CheckCircle2 size={16} />
                  {busy ? 'Activating…' : 'Activate for Nurturing'}
                </button>
                {steps.pct < 100 && (
                  <p className="text-center text-[11px] text-ams-muted">
                    Still missing: {missingSteps(c).join(' · ')}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {tab === 'nurturing' && <NurturingPanels />}

      <LinkWhatsAppDrawer
        open={linkOpen}
        account={account}
        slot={account?.wsaf_slot ?? null}
        engineSlots={engineSlots}
        slotTakenBy={slotTakenBy}
        engineReachable={engineReachable}
        engineStatus={engineStatus}
        onEngineRefresh={refetchEngine}
        onSlotChange={changeEngineSlot}
        onClose={() => setLinkOpen(false)}
        onLinked={async () => {
          if (account) {
            await patchAccount.mutateAsync({
              id: account.id,
              row: account,
              patch: { linked_override: true },
            });
            if (account.wsaf_slot != null && account.account_name) {
              await api.post(`/bridge/slots/${account.wsaf_slot}/display-label`, {
                accountName: account.account_name,
                phone: account.phone_number || null,
              }).catch(() => {});
            }
          }
          invalidate();
          showToast(toastCopy.activationLinked(account?.account_name));
        }}
      />

      <Toast open={!!toast} message={toast} tone="success" onClose={() => setToast('')} />
    </div>
  );
}
