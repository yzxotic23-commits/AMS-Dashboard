import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, CheckCircle2, Clock, ScanLine } from 'lucide-react';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import IconTooltip from '../components/IconTooltip';
import Toast from '../components/Toast';
import { useSite } from '../context/SiteContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useAccountsByStatus, useAccountMutations } from '../hooks/useOperatorAccounts';
import { useFreeIps } from '../hooks/useResourceOptions';
import {
  isAutoGraduationDue, isManualScanDue, nurturingDay,
} from '../lib/nurturing-day';
import { NURT_STATUS, toastCopy } from '../lib/operator-copy';

function ProgressBar({ day, max, tone = 'warn' }) {
  const pct = Math.min(100, Math.round((day / max) * 100));
  return (
    <div className="nurt-progress">
      <div className="nurt-progress-track">
        <div className={`nurt-progress-fill nurt-progress-fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="nurt-progress-label">Day {day}/{max}</span>
    </div>
  );
}

const BAN_REASONS_MANUAL = [
  'Number rejected by platform',
  'Verification failed',
  'Device / SIM issue',
  'IP flagged during manual phase',
  'Other',
];

function NurturingColGroup({ showSite }) {
  return (
    <colgroup>
      <col className="nurt-col-acct" />
      <col className="nurt-col-device" />
      <col className="nurt-col-progress" />
      <col className="nurt-col-status" />
      {showSite && <col className="nurt-col-site" />}
      <col className="nurt-col-action" />
    </colgroup>
  );
}

function NurturingTableHead({ showSite }) {
  return (
    <thead>
      <tr>
        <th>Account</th>
        <th>Device / Slot</th>
        <th className="col-center">Progress</th>
        <th className="col-center">Status</th>
        {showSite && <th className="col-center">Site</th>}
        <th className="col-action col-action--wide">Action</th>
      </tr>
    </thead>
  );
}

export default function NurturingPage() {
  const { site } = useSite();
  const navigate = useNavigate();
  const [scanRow, setScanRow] = useState(null);
  const [banRow, setBanRow] = useState(null);
  const [banReason, setBanReason] = useState(BAN_REASONS_MANUAL[0]);
  const [scanIp, setScanIp] = useState('');
  const [scanOk, setScanOk] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: nurturing = [], isLoading } = useAccountsByStatus('NURTURING');
  const { patchAccount, transitionAccount, banAccount } = useAccountMutations();

  const scanSite = scanRow?.siteKey || 'my';
  const freeIps = useFreeIps(scanSite);

  const manualList = useMemo(() => {
    const rows = nurturing
      .filter((r) => r.nurturing_phase === 'manual')
      .map((r) => ({
        ...r,
        acct: r.account_name,
        dev: r.device,
        ch: r.channel,
        day: nurturingDay(r.nurturing_started_at, 'manual'),
      }));
    if (site === 'all') return rows;
    return rows.filter((r) => r.siteKey === site);
  }, [nurturing, site]);

  const autoList = useMemo(() => {
    const rows = nurturing
      .filter((r) => r.nurturing_phase === 'auto')
      .map((r) => ({
        ...r,
        acct: r.account_name,
        dev: r.device,
        ch: r.channel,
        day: nurturingDay(r.nurturing_started_at, 'auto'),
      }));
    if (site === 'all') return rows;
    return rows.filter((r) => r.siteKey === site);
  }, [nurturing, site]);

  const scanReadyCount = useMemo(
    () => manualList.filter(isManualScanDue).length,
    [manualList],
  );
  const gradReadyCount = useMemo(
    () => autoList.filter(isAutoGraduationDue).length,
    [autoList],
  );
  const activeCount = manualList.length + autoList.length;

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3800);
  }

  function openScan(row) {
    setScanIp(row.ip || freeIps[0]?.ip_address || '');
    setScanOk(false);
    setScanRow(row);
  }

  async function submitScan() {
    if (!scanRow || busy) return;
    if (!scanOk) {
      showToast(toastCopy.nurturingConfirmIp());
      return;
    }
    setBusy(true);
    try {
      const ipRow = freeIps.find((ip) => ip.ip_address === scanIp);
      await patchAccount.mutateAsync({
        id: scanRow.id,
        row: scanRow,
        patch: {
          ip: scanIp,
          ip_id: ipRow?.id || null,
          nurturing_phase: 'auto',
        },
        extra: {},
      });
      setScanRow(null);
      showToast(toastCopy.nurturingScanIn(scanRow.acct));
    } catch (e) {
      showToast(e.message || 'Scan-in failed');
    } finally {
      setBusy(false);
    }
  }

  function openBan(row, manual) {
    setBanRow({ ...row, manualPhase: manual });
    setBanReason(BAN_REASONS_MANUAL[0]);
  }

  async function submitBan() {
    if (!banRow || busy) return;
    setBusy(true);
    try {
      await banAccount.mutateAsync({
        id: banRow.id,
        stage: banRow.manualPhase ? 'manual' : 'auto',
        reason: banReason,
      });
      setBanRow(null);
      showToast(toastCopy.nurturingBanned(banRow.acct));
      navigate('/recovery');
    } catch (e) {
      showToast(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function markBanned(row, manual) {
    if (manual) {
      openBan(row, true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await banAccount.mutateAsync({
        id: row.id,
        stage: 'auto',
        reason: 'Operator flagged during auto nurturing',
      });
      showToast(toastCopy.nurturingBanned(row.acct));
      navigate('/recovery');
    } catch (e) {
      showToast(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function graduate(row) {
    if (busy) return;
    setBusy(true);
    try {
      await transitionAccount.mutateAsync({
        id: row.id,
        to_status: 'AVAILABLE',
        reason: 'Nurturing complete — moved to standby pool',
      });
      showToast(toastCopy.nurturingGraduated(row.acct));
    } catch (e) {
      showToast(e.message || 'Graduation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Nurturing"
        description="Device farm phase (days 1–3): accounts stay on physical phones — operators track batches, not 1:1 chat. After scan-in, the engine monitors through day 7."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-accent">{activeCount}</span>
            <span>active</span>
            <span className="text-ams-faint">·</span>
            <span>{manualList.length} farm</span>
            <span className="text-ams-faint">·</span>
            <span>{autoList.length} auto</span>
            {scanReadyCount > 0 && (
              <>
                <span className="text-ams-faint">·</span>
                <span className="font-semibold text-ams-warn">{scanReadyCount}</span>
                <span>ready scan</span>
              </>
            )}
            {gradReadyCount > 0 && (
              <>
                <span className="text-ams-faint">·</span>
                <span className="font-semibold text-ams-success">{gradReadyCount}</span>
                <span>ready graduate</span>
              </>
            )}
          </div>
        )}
      />

      <div className="page-subhead">
        <h3>Device farm (days 1–3 · batch-tracked)</h3>
      </div>

      <div className="nurt-table-stack data-panel card mb-6 overflow-hidden">
        <div className="data-table-wrap">
          <table className={`data-table data-table--nurturing${site === 'all' ? ' data-table--nurturing-all' : ''}`}>
            <NurturingColGroup showSite={site === 'all'} />
            <NurturingTableHead showSite={site === 'all'} />
            <tbody>
              {isLoading ? (
                <tr><td colSpan={site === 'all' ? 6 : 5} className="empty-cell">Loading…</td></tr>
              ) : manualList.length === 0 ? (
                <tr>
                  <td colSpan={site === 'all' ? 6 : 5} className="empty-cell">
                    No accounts in device farm phase at this site.
                  </td>
                </tr>
              ) : manualList.map((row) => {
                const due = isManualScanDue(row);
                return (
                  <tr key={row.id}>
                    <td className="font-semibold text-ams-blue">{row.acct}</td>
                    <td className="col-mono">{row.dev} · {row.ch}</td>
                    <td className="col-center">
                      <ProgressBar day={row.day} max={3} tone="warn" />
                    </td>
                    <td className="col-center">
                      <span className="badge badge-warn">
                        {due ? NURT_STATUS.readyScan : NURT_STATUS.manual}
                      </span>
                    </td>
                    {site === 'all' && (
                      <td className="col-center">
                        <span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span>
                      </td>
                    )}
                    <td className="col-action col-action--wide">
                      <div className="col-action-btns">
                        {due ? (
                          <IconTooltip label="Confirm scan-in">
                            <button
                              type="button"
                              className="table-icon-btn table-icon-btn--accent"
                              onClick={() => openScan(row)}
                              aria-label="Confirm scan-in"
                            >
                              <ScanLine size={15} strokeWidth={2} />
                            </button>
                          </IconTooltip>
                        ) : (
                          <IconTooltip label="Awaiting day 3">
                            <button
                              type="button"
                              className="table-icon-btn opacity-40"
                              disabled
                              aria-label="Awaiting day 3"
                            >
                              <Clock size={15} strokeWidth={2} />
                            </button>
                          </IconTooltip>
                        )}
                        <IconTooltip label="Mark banned">
                          <button
                            type="button"
                            className="table-icon-btn table-icon-btn--danger"
                            onClick={() => markBanned(row, true)}
                            aria-label="Mark banned"
                          >
                            <Ban size={15} strokeWidth={2} />
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

      <div className="page-subhead">
        <h3>Auto nurturing (days 4–7 · engine monitored)</h3>
      </div>

      <div className="nurt-table-stack data-panel card overflow-hidden">
        <div className="data-table-wrap">
          <table className={`data-table data-table--nurturing${site === 'all' ? ' data-table--nurturing-all' : ''}`}>
            <NurturingColGroup showSite={site === 'all'} />
            <NurturingTableHead showSite={site === 'all'} />
            <tbody>
              {isLoading ? (
                <tr><td colSpan={site === 'all' ? 6 : 5} className="empty-cell">Loading…</td></tr>
              ) : autoList.length === 0 ? (
                <tr>
                  <td colSpan={site === 'all' ? 6 : 5} className="empty-cell">
                    No accounts in auto nurturing at this site.
                  </td>
                </tr>
              ) : autoList.map((row) => {
                const gradDue = isAutoGraduationDue(row);
                return (
                  <tr key={row.id}>
                    <td className="font-semibold text-ams-blue">{row.acct}</td>
                    <td className="col-mono">{row.dev} · {row.ch}</td>
                    <td className="col-center">
                      <ProgressBar day={row.day} max={7} tone="blue" />
                    </td>
                    <td className="col-center">
                      <span className={`badge ${gradDue ? 'badge-success' : 'badge-accent'}`}>
                        {gradDue ? 'Ready for standby' : NURT_STATUS.auto}
                      </span>
                    </td>
                    {site === 'all' && (
                      <td className="col-center">
                        <span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span>
                      </td>
                    )}
                    <td className="col-action col-action--wide">
                      <div className="col-action-btns">
                        {gradDue ? (
                          <IconTooltip label="Move to standby pool">
                            <button
                              type="button"
                              className="table-icon-btn table-icon-btn--success"
                              onClick={() => graduate(row)}
                              aria-label="Move to standby pool"
                            >
                              <CheckCircle2 size={15} strokeWidth={2} />
                            </button>
                          </IconTooltip>
                        ) : (
                          <IconTooltip label="Engine monitoring">
                            <button
                              type="button"
                              className="table-icon-btn opacity-40"
                              disabled
                              aria-label="Engine monitoring"
                            >
                              <Clock size={15} strokeWidth={2} />
                            </button>
                          </IconTooltip>
                        )}
                        <IconTooltip label="Mark banned">
                          <button
                            type="button"
                            className="table-icon-btn table-icon-btn--danger"
                            onClick={() => markBanned(row, false)}
                            aria-label="Mark banned"
                          >
                            <Ban size={15} strokeWidth={2} />
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
        open={!!scanRow}
        title="Scan into Auto Nurturing"
        onClose={() => setScanRow(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setScanRow(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={submitScan} disabled={busy}>
              {busy ? 'Saving…' : 'Confirm Auto Nurturing'}
            </button>
          </>
        )}
      >
        {scanRow && (
          <div className="space-y-4">
            <p className="drawer-hint">
              WhatsApp was linked during Activation. Confirm the account is ready to move from device farm to engine-monitored auto nurturing (days 4–7).
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Account</div>
              <div className="text-sm font-semibold">{scanRow.acct}</div>
            </div>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Device / Slot · Location</div>
              <div className="text-sm font-mono">{scanRow.dev} · {scanRow.ch}</div>
              <div className="mt-1 text-xs text-ams-faint">
                {SITES[scanRow.siteKey].name}
              </div>
            </div>
            <label className="drawer-field">
              <span className="drawer-label">Engine IP (from IP Ledger)</span>
              <select
                className="input font-mono"
                value={scanIp}
                onChange={(e) => setScanIp(e.target.value)}
              >
                {freeIps.map((ip) => (
                  <option key={ip.id} value={ip.ip_address}>{ip.ip_address}</option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2.5 text-[13px] text-ams-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={scanOk}
                onChange={(e) => setScanOk(e.target.checked)}
              />
              Device farm phase is complete — hand off to engine monitoring
            </label>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!banRow}
        title="Mark Banned (Manual Phase)"
        onClose={() => setBanRow(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setBanRow(null)}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={submitBan} disabled={busy}>
              {busy ? 'Saving…' : 'Confirm Ban'}
            </button>
          </>
        )}
      >
        {banRow && (
          <div className="space-y-4">
            <p className="drawer-hint">
              Days 1–3 require a ban reason. This is logged for ban-rate statistics and IP risk tracking.
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Account</div>
              <div className="text-sm font-semibold">{banRow.acct}</div>
            </div>
            <label className="drawer-field">
              <span className="drawer-label">Ban reason (required)</span>
              <select
                className="input"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
              >
                {BAN_REASONS_MANUAL.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
        )}
      </Drawer>

      <Toast open={!!toast} message={toast} onClose={() => setToast('')} />
    </div>
  );
}
