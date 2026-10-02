import { useMemo, useState } from 'react';
import { CheckCircle2, Package, RefreshCw, ScrollText, XCircle } from 'lucide-react';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import IconTooltip from '../components/IconTooltip';
import Toast from '../components/Toast';
import { useAccountsByStatus, useAccountMutations } from '../hooks/useOperatorAccounts';
import { useSite } from '../context/SiteContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import {
  parseRecoveryMeta, serializeRecoveryNotes, appendRecoveryLog,
  banSourceLabel, recElapsed,
} from '../lib/account-recovery-meta';
import { buildMetaPatch } from '../lib/account-operator-meta';
import { RECOVERY_STATUS, toastCopy } from '../lib/operator-copy';
import { SIM_ANOMALY_EXCEPTION, simAnomalyReasonLabel } from '../lib/sim-meta';

const REC_FAIL_REASONS = [
  'SIM issue (expired / not topped up / deactivated)',
  'Code received but recovery still failed',
  'Permanently banned by platform',
  'Other',
];

function accountToRecoveryRow(account) {
  const rec = parseRecoveryMeta({ notes: account._notes }) || { recovery_status: 'need', log: [] };
  const simAnomaly = rec.cause === SIM_ANOMALY_EXCEPTION;
  const from = simAnomaly
    ? `SIM Card Anomaly · ${simAnomalyReasonLabel(rec.sim_reason)}`
    : banSourceLabel(rec.ban_stage || rec.ban_reason || 'Banned');
  // SIM anomalies land directly in RECOVERING but still wait in "need" until an operator starts.
  const simWaiting = simAnomaly && (rec.recovery_status || 'need') === 'need';
  return {
    id: account.id,
    acct: account.account_name,
    dev: account.device,
    ch: account.channel,
    sim: account.sim,
    siteKey: account.siteKey,
    status: account.status,
    st: account.status === 'RECOVERING' && !simWaiting ? 'doing' : (rec.recovery_status || 'need'),
    from,
    simAnomaly,
    log: rec.log || [],
    notes: account.human_note,
    row: account,
    rec,
  };
}

export default function RecoveryPage() {
  const { site } = useSite();
  const [failRow, setFailRow] = useState(null);
  const [failReason, setFailReason] = useState(REC_FAIL_REASONS[0]);
  const [logRow, setLogRow] = useState(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: banned = [], isLoading: loadingBanned } = useAccountsByStatus('BANNED');
  const { data: recovering = [], isLoading: loadingRec } = useAccountsByStatus('RECOVERING');
  const { patchAccount, transitionAccount } = useAccountMutations();

  const list = useMemo(() => {
    const rows = [...banned, ...recovering].map((a) => accountToRecoveryRow(a));
    const filtered = site === 'all' ? rows : rows.filter((r) => r.siteKey === site);
    return filtered.sort((a, b) => a.acct.localeCompare(b.acct, undefined, { sensitivity: 'base' }));
  }, [banned, recovering, site]);

  const pending = list.filter((r) => r.st === 'need' || r.st === 'doing').length;

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3800);
  }

  async function advance(row, to) {
    const now = new Date().toISOString();
    const logSt = to === 'standby' ? 'ok' : to;
    const nextMeta = appendRecoveryLog(row.rec, {
      st: logSt,
      time: now,
      by: 'Operator',
      ...(to === 'ok' ? { destination: 'nurturing' } : {}),
      ...(to === 'standby' ? { destination: 'standby' } : {}),
    });
    if (busy) return;
    setBusy(true);
    try {
      if (to === 'doing') {
        if (row.status !== 'RECOVERING') {
          await transitionAccount.mutateAsync({
            id: row.id,
            to_status: 'RECOVERING',
            reason: 'Recovery started',
          });
        }
        await patchAccount.mutateAsync({
          id: row.id,
          row: row.row,
          patch: {},
          extra: { notes: serializeRecoveryNotes(row.row._notes || '', nextMeta) },
        });
        showToast(toastCopy.recoveryStarted(row.acct));
      } else if (to === 'ok') {
        // Draft: Recovering → Nurturing (resume feeding path).
        await transitionAccount.mutateAsync({
          id: row.id,
          to_status: 'NURTURING',
          reason: 'Recovery successful — returned to nurturing for feeding',
        });
        const baseNotes = buildMetaPatch(row.row, {
          nurturing_phase: 'manual',
          nurturing_started_at: now,
        });
        await patchAccount.mutateAsync({
          id: row.id,
          row: row.row,
          patch: {
            nurturing_phase: 'manual',
            nurturing_started_at: now,
          },
          extra: { notes: serializeRecoveryNotes(baseNotes, nextMeta) },
        });
        showToast(toastCopy.recoveryDone(row.acct, recElapsed(nextMeta.log, 'ok')));
      } else if (to === 'standby') {
        // Draft: Recovering → Standby (AVAILABLE) for business handoff.
        await transitionAccount.mutateAsync({
          id: row.id,
          to_status: 'AVAILABLE',
          reason: 'Recovery successful — returned to standby pool',
        });
        await patchAccount.mutateAsync({
          id: row.id,
          row: row.row,
          patch: {},
          extra: { notes: serializeRecoveryNotes(row.row._notes || '', nextMeta) },
        });
        showToast(toastCopy.recoveryDoneStandby(row.acct, recElapsed(nextMeta.log, 'ok')));
      }
    } catch (e) {
      showToast(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitFail() {
    if (!failRow || busy) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const nextMeta = appendRecoveryLog(failRow.rec, {
        st: 'fail', time: now, by: 'Operator', reason: failReason,
      });
      await transitionAccount.mutateAsync({
        id: failRow.id,
        to_status: 'RECYCLED',
        reason: `Recovery failed — ${failReason}`,
      });
      await patchAccount.mutateAsync({
        id: failRow.id,
        row: failRow.row,
        patch: {},
        extra: { notes: serializeRecoveryNotes(failRow.row._notes || '', nextMeta) },
      });
      showToast(toastCopy.recoveryFailed(failRow.acct, recElapsed(nextMeta.log, 'fail'), failReason));
      setFailRow(null);
    } catch (e) {
      showToast(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Account Recovery"
        description="Banned and SIM Card Anomaly accounts queue here. Pending → Recovering → Nurturing, Standby, or Failed (Recycled). Every step is timestamped for recovery-time stats."
        actions={pending > 0 ? (
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-danger">{pending}</span>
            <span>pending recovery</span>
          </div>
        ) : null}
      />

      <div className="page-subhead">
        <h3>Accounts Awaiting Recovery</h3>
      </div>

      <div className="data-panel card overflow-hidden">
        <div className="data-table-wrap">
          <table className="data-table data-table--recovery">
            <colgroup>
              <col className="rec-col-acct" />
              <col className="rec-col-ban" />
              <col className="rec-col-status" />
              <col className="rec-col-elapsed" />
              {site === 'all' && <col className="rec-col-site" />}
              <col className="rec-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Account</th>
                <th>Ban Source</th>
                <th>Recovery Status</th>
                <th>Elapsed</th>
                {site === 'all' && <th className="col-center">Site</th>}
                <th className="col-action col-action--wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingBanned || loadingRec ? (
                <tr><td colSpan={site === 'all' ? 6 : 5} className="empty-cell">Loading…</td></tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={site === 'all' ? 6 : 5} className="empty-cell">
                    No accounts awaiting recovery at this site.
                  </td>
                </tr>
              ) : list.map((row) => {
                const stKey = row.st;
                const st = { need: { label: RECOVERY_STATUS.need, pill: 'badge-warn' }, doing: { label: RECOVERY_STATUS.doing, pill: 'badge-accent' }, ok: { label: RECOVERY_STATUS.ok, pill: 'badge-success' }, fail: { label: RECOVERY_STATUS.fail, pill: 'badge-danger' } }[stKey] || { label: RECOVERY_STATUS.need, pill: 'badge-warn' };
                return (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className="font-semibold text-ams-blue hover:underline"
                        onClick={() => setLogRow(row)}
                      >
                        {row.acct}
                      </button>
                    </td>
                    <td>
                      <span className={`badge ${row.simAnomaly ? 'badge-warn' : 'badge-danger'}`}>{row.from}</span>
                    </td>
                    <td><span className={`badge ${st.pill}`}>{st.label}</span></td>
                    <td className="text-sm text-ams-muted">{recElapsed(row.log, row.st)}</td>
                    {site === 'all' && (
                      <td className="col-center">
                        <span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span>
                      </td>
                    )}
                    <td className="col-action col-action--wide">
                      <div className="col-action-btns">
                        {row.st === 'need' && (row.status === 'BANNED' || row.simAnomaly) && (
                          <IconTooltip label="Start recovery">
                            <button
                              type="button"
                              className="table-icon-btn table-icon-btn--accent"
                              onClick={() => advance(row, 'doing')}
                              aria-label="Start recovery"
                            >
                              <RefreshCw size={15} strokeWidth={2} />
                            </button>
                          </IconTooltip>
                        )}
                        {row.st === 'doing' && (
                          <>
                            <IconTooltip label="Recovered → Nurturing (feeding)">
                              <button
                                type="button"
                                className="table-icon-btn table-icon-btn--success"
                                onClick={() => advance(row, 'ok')}
                                aria-label="Recovered — back to nurturing"
                              >
                                <CheckCircle2 size={15} strokeWidth={2} />
                              </button>
                            </IconTooltip>
                            <IconTooltip label="Recovered → Standby (Available)">
                              <button
                                type="button"
                                className="table-icon-btn table-icon-btn--accent"
                                onClick={() => advance(row, 'standby')}
                                aria-label="Recovered — send to standby"
                              >
                                <Package size={15} strokeWidth={2} />
                              </button>
                            </IconTooltip>
                            <IconTooltip label="Failed → Recycled">
                              <button
                                type="button"
                                className="table-icon-btn table-icon-btn--danger"
                                onClick={() => { setFailReason(REC_FAIL_REASONS[0]); setFailRow(row); }}
                                aria-label="Log failure — recycle"
                              >
                                <XCircle size={15} strokeWidth={2} />
                              </button>
                            </IconTooltip>
                          </>
                        )}
                        <IconTooltip label="View log">
                          <button
                            type="button"
                            className="table-icon-btn"
                            onClick={() => setLogRow(row)}
                            aria-label="View recovery log"
                          >
                            <ScrollText size={15} strokeWidth={2} />
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
      </div>

      <Drawer
        open={!!failRow}
        title="Log Recovery Failure"
        onClose={() => setFailRow(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setFailRow(null)}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={submitFail}>
              Log Failure
            </button>
          </>
        )}
      >
        {failRow && (
          <div className="space-y-4">
            <p className="rounded-lg bg-ams-surface-muted px-3 py-2 text-[12.5px] leading-relaxed text-ams-muted">
              Log the failure reason to separate SIM issues from other causes. Unrecoverable accounts are scrapped and slots freed for re-registration.
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Account · Ban source</div>
              <div className="text-sm font-semibold">
                {failRow.acct}
                <span className="ml-2 text-xs font-normal text-ams-faint">{failRow.from}</span>
              </div>
            </div>
            <div className="drawer-locked">
              <div className="drawer-locked-label">SIM</div>
              <div className="text-sm">{failRow.sim}</div>
            </div>
            <label className="drawer-field">
              <span className="drawer-label">Failure reason</span>
              <select
                className="input"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
              >
                {REC_FAIL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!logRow}
        title="Recovery Log"
        onClose={() => setLogRow(null)}
        footer={(
          <button type="button" className="btn btn-ghost flex-1" onClick={() => setLogRow(null)}>Close</button>
        )}
      >
        {logRow && (
          <div className="space-y-4">
            <div className="drawer-locked">
              <div className="drawer-locked-label">Account</div>
              <div className="text-sm font-semibold">{logRow.acct}</div>
              <div className="mt-1 text-xs text-ams-faint font-mono">{logRow.dev} · {logRow.ch}</div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ams-muted">
                Status timeline
              </div>
              <ul className="rec-timeline">
                {(logRow.log || []).map((entry, i) => (
                  <li key={i} className="rec-timeline-item">
                    <div className="rec-timeline-dot" />
                    <div>
                      <div className="text-sm font-medium text-ams-ink">{RECOVERY_STATUS[entry.st] || entry.st}</div>
                      <div className="text-xs text-ams-faint">{entry.time} · {entry.by}</div>
                      {entry.reason && (
                        <div className="mt-0.5 text-xs text-ams-muted">{entry.reason}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-xs text-ams-faint">
              Elapsed this round: <strong className="text-ams-muted">{recElapsed(logRow.log, logRow.st)}</strong>
            </div>
          </div>
        )}
      </Drawer>

      <Toast open={!!toast} message={toast} tone="success" onClose={() => setToast('')} />
    </div>
  );
}
