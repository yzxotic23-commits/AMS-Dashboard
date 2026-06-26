import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import PageHead from '../components/PageHead';
import IconTooltip from '../components/IconTooltip';
import NurturingPanels from '../components/NurturingPanels';
import Toast from '../components/Toast';
import { useSite } from '../context/SiteContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useAccountsByStatus, useAccountMutations } from '../hooks/useOperatorAccounts';
import { toastCopy } from '../lib/operator-copy';
import {
  isAutoGraduationDue, isManualScanDue,
} from '../lib/nurturing-day';

const ACTIVATION_STEPS = ['sim', 'device', 'ip', 'phone'];

const PAGE_TABS = [
  { id: 'activation', label: 'Activation' },
  { id: 'nurturing', label: 'Nurturing' },
];

function checklist(account) {
  return {
    sim: !!(account.sim_id || account.sim),
    device: !!(account.device_id || account.device),
    ip: !!(account.ip_id || account.ip),
    phone: !!(account.phone_number && account.phone_number.trim()),
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
  };
  return ACTIVATION_STEPS.filter((k) => !c[k]).map((k) => labels[k]);
}

function isActivationReady(ch) {
  return ACTIVATION_STEPS.every((k) => ch[k]);
}

function activateTooltip(ready, activating, ch) {
  if (activating) return 'Activating…';
  if (!ready) return `Missing: ${missingSteps(ch).join(', ')}`;
  return 'Activate Nurturing';
}

function resourceSummary(row) {
  const parts = [row.device, row.ip].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export default function ActivationDeskPage() {
  const { site } = useSite();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'nurturing' ? 'nurturing' : 'activation';
  const [busyId, setBusyId] = useState(null);
  const [queueFilter, setQueueFilter] = useState('all');
  const [toast, setToast] = useState('');
  const { data: queue = [], isLoading } = useAccountsByStatus('REGISTERING');
  const { data: nurturing = [] } = useAccountsByStatus('NURTURING');
  const { patchAccount, transitionAccount, invalidate } = useAccountMutations();

  const list = useMemo(() => {
    if (site === 'all') return queue;
    return queue.filter((r) => r.siteKey === site);
  }, [queue, site]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3800);
  };

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

  const readyCount = list.filter((a) => isActivationReady(checklist(a))).length;

  const filteredList = useMemo(() => {
    if (queueFilter !== 'ready') return list;
    return list.filter((a) => isActivationReady(checklist(a)));
  }, [list, queueFilter]);

  function setTab(nextTab) {
    if (nextTab === 'nurturing') {
      setSearchParams({ tab: 'nurturing' }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  async function activate(row) {
    if (!row || busyId) return;
    const ch = checklist(row);
    if (!isActivationReady(ch)) {
      showToast(`Complete at Register: ${missingSteps(ch).join(', ')}`);
      return;
    }
    setBusyId(row.id);
    try {
      await patchAccount.mutateAsync({
        id: row.id,
        row,
        patch: {
          nurturing_phase: 'manual',
          nurturing_started_at: new Date().toISOString(),
        },
      });
      await transitionAccount.mutateAsync({
        id: row.id,
        to_status: 'NURTURING',
        reason: 'Activated for nurturing',
      });
      invalidate();
      setTab('nurturing');
      showToast(toastCopy.activationDone(row.account_name));
    } catch (e) {
      showToast(e.message || 'Activation failed');
    } finally {
      setBusyId(null);
    }
  }

  const colSpan = site === 'all' ? 6 : 5;

  return (
    <div>
      <PageHead
        title="Activation & Nurturing"
        description="Resources are assigned at Register. Activate ready accounts for device-farm nurturing — FeedFlow link happens at day-3 scan-in."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-accent">{list.length}</span>
            <span>activation</span>
            <span className="text-ams-faint">·</span>
            <span>{readyCount} ready</span>
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

      {tab === 'activation' && (
      <div className="activation-stats" role="group" aria-label="Filter activation queue">
        <button
          type="button"
          className={`activation-stat${queueFilter === 'all' ? ' activation-stat--active' : ''}`}
          aria-pressed={queueFilter === 'all'}
          onClick={() => setQueueFilter('all')}
        >
          <span className="activation-stat-label">In queue</span>
          <span className="activation-stat-val">{list.length}</span>
        </button>
        <button
          type="button"
          className={`activation-stat activation-stat--ready${queueFilter === 'ready' ? ' activation-stat--active' : ''}`}
          aria-pressed={queueFilter === 'ready'}
          onClick={() => setQueueFilter('ready')}
        >
          <span className="activation-stat-label">Ready to activate</span>
          <span className="activation-stat-val">{readyCount}</span>
        </button>
      </div>
      )}

      {tab === 'activation' && (
      <>
      <div className="page-subhead">
        <h3>Activation queue</h3>
      </div>
      <div className="data-panel card overflow-hidden">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Device · IP</th>
                <th>Phone</th>
                <th>Progress</th>
                {site === 'all' && <th className="col-center">Site</th>}
                <th className="col-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={colSpan} className="empty-cell">Loading…</td></tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="empty-cell">
                    {queueFilter === 'ready'
                      ? 'No accounts ready to activate yet.'
                      : 'No accounts awaiting activation. Register a number first.'}
                  </td>
                </tr>
              ) : filteredList.map((row) => {
                const ch = checklist(row);
                const sp = stepProgress(ch);
                const ready = isActivationReady(ch);
                const activating = busyId === row.id;
                return (
                  <tr key={row.id}>
                    <td className="font-semibold text-ams-blue">{row.account_name}</td>
                    <td className="font-mono text-[12px] text-ams-muted">{resourceSummary(row)}</td>
                    <td className="font-mono text-[12px]">{row.phone_number || '—'}</td>
                    <td>
                      <div className="nurt-progress">
                        <div className="nurt-progress-track">
                          <div
                            className={`nurt-progress-fill ${ready ? 'nurt-progress-fill--ok' : 'nurt-progress-fill--warn'}`}
                            style={{ width: `${sp.pct}%` }}
                          />
                        </div>
                        <span className="nurt-progress-label">
                          {ready ? 'Ready' : `Missing ${missingSteps(ch).join(', ')}`}
                        </span>
                      </div>
                    </td>
                    {site === 'all' && (
                      <td className="col-center">
                        <span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span>
                      </td>
                    )}
                    <td className="col-action">
                      <IconTooltip label={activateTooltip(ready, activating, ch)}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
                          disabled={!ready || activating || !!busyId}
                          onClick={() => activate(row)}
                        >
                          <CheckCircle2 size={14} />
                          {activating ? 'Activating…' : 'Activate'}
                        </button>
                      </IconTooltip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {tab === 'nurturing' && <NurturingPanels />}

      <Toast open={!!toast} message={toast} tone="success" onClose={() => setToast('')} />
    </div>
  );
}
