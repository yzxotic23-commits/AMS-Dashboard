import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, Clock, ScanLine } from 'lucide-react';
import Drawer from './Drawer';
import IconTooltip from './IconTooltip';
import Toast from './Toast';
import LinkWhatsAppDrawer from './LinkWhatsAppDrawer';
import { useSite } from '../context/SiteContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { useAccountsByStatus, useAccountMutations, useAllAccounts } from '../hooks/useOperatorAccounts';
import { useFreeIps } from '../hooks/useResourceOptions';
import {
  isAutoGraduationDue, isManualScanDue, nurturingDay,
} from '../lib/nurturing-day';
import { NURT_STATUS, toastCopy } from '../lib/operator-copy';
import { formatProxyOptionLabel, proxyUrlFromIp } from '../lib/proxy-display';
import { FEEDING_STATUS, feedflowSlotLabelBody, nurturingOutcomeAuditPayload } from '../lib/feeding-audit';
import { buildSlotTakenByMap, liveSlotConnection } from '../lib/engine-slot';
import {
  clearSlotDisplayLabel,
  isEngineSlotLinked,
  recordFeedingAuditEntry,
  syncSlotDisplayLabelToEngine,
  syncSlotProxyToEngine,
} from '../lib/bridge-client';
import {
  buildIpBindings,
  isIpSelectableForAccount,
  ipBindingCount,
  proxyBindingSuffix,
} from '../lib/ip-ready';

const PROGRESS_FILL_CLASS = {
  warn: 'nurt-progress-fill nurt-progress-fill--warn',
  ok: 'nurt-progress-fill nurt-progress-fill--ok',
  blue: 'nurt-progress-fill nurt-progress-fill--blue',
};

function ProgressBar({ day, max, tone = 'warn' }) {
  const pct = Math.min(100, Math.round((day / max) * 100));
  return (
    <div className="nurt-progress">
      <div className="nurt-progress-track">
        <div className={PROGRESS_FILL_CLASS[tone] || PROGRESS_FILL_CLASS.warn} style={{ width: `${pct}%` }} />
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

export default function NurturingPanels() {
  const { site } = useSite();
  const navigate = useNavigate();
  const [scanRow, setScanRow] = useState(null);
  const [banRow, setBanRow] = useState(null);
  const [banReason, setBanReason] = useState(BAN_REASONS_MANUAL[0]);
  const [scanIpId, setScanIpId] = useState('');
  const [scanOk, setScanOk] = useState(false);
  const [scanSlot, setScanSlot] = useState(null);
  const [feedflowLinked, setFeedflowLinked] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { data: nurturing = [], isLoading } = useAccountsByStatus('NURTURING');
  const { data: allAccounts = [] } = useAllAccounts();
  const { patchAccount, transitionAccount, banAccount } = useAccountMutations();
  const { data: engineData, refetch: refetchEngine } = useEngineStatus();

  /** Mirror operator Strict/Banned into FeedFlow feeding audit (needs wsaf_slot). */
  async function syncOutcomeToFeedingAudit(row, feedingStatus) {
    if (row?.wsaf_slot == null) return;
    try {
      await recordFeedingAuditEntry(nurturingOutcomeAuditPayload(row, feedingStatus));
      qc.invalidateQueries({ queryKey: ['bridge', 'audit'] });
    } catch {
      /* engine offline — nurturing action already succeeded */
    }
  }

  const engineReachable = engineData?.reachable === true;
  const engineSlots = engineData?.slots || engineData?.accounts || engineData?.engine?.slots || [];
  const { list: freeIps } = useFreeIps();
  const scanProxyUrl = useMemo(() => {
    const ipRow = freeIps.find((ip) => ip.id === scanIpId);
    return proxyUrlFromIp(ipRow);
  }, [freeIps, scanIpId]);

  // Only NURTURING / IN_USE hold slots — Standby (tiffany etc.) must not block reuse.
  const slotTakenBy = useMemo(
    () => buildSlotTakenByMap(allAccounts, scanRow?.id),
    [allAccounts, scanRow?.id],
  );

  // Push proxy as soon as operator picks IP + slot — before QR/pairing (kills scam popup).
  useEffect(() => {
    if (!scanRow || scanSlot == null || !scanProxyUrl) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await syncSlotProxyToEngine(scanSlot, scanProxyUrl);
      } catch {
        if (!cancelled) {
          /* link step will retry / surface error */
        }
      }
    })();
    return () => { cancelled = true; };
  }, [scanRow, scanSlot, scanProxyUrl]);

  const ipBindings = useMemo(() => buildIpBindings(allAccounts), [allAccounts]);

  function pickDefaultScanIp(row) {
    if (row.ip_id) {
      const current = freeIps.find((ip) => ip.id === row.ip_id);
      if (current && isIpSelectableForAccount(current, ipBindings, row.ip_id)) return current;
    }
    const byAddress = freeIps.find(
      (ip) => ip.ip_address === row.ip && isIpSelectableForAccount(ip, ipBindings, row.ip_id),
    );
    if (byAddress) return byAddress;
    return freeIps.find((ip) => isIpSelectableForAccount(ip, ipBindings, row.ip_id)) || null;
  }

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

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3800);
  }

  function openScan(row) {
    const defaultIp = pickDefaultScanIp(row);
    const slot = row.wsaf_slot ?? null;
    setScanIpId(defaultIp?.id || '');
    setScanOk(false);
    setScanSlot(slot);
    setFeedflowLinked(false);
    setScanRow(row);
    refetchEngine().then(({ data }) => {
      if (slot == null) return;
      const live = (data?.slots || []).find((s) => Number(s.slot) === Number(slot));
      if (isEngineSlotLinked(live)) setFeedflowLinked(true);
    });
  }

  useEffect(() => {
    if (!scanRow || scanSlot == null) return undefined;
    const slotState = engineSlots.find((s) => Number(s.slot) === Number(scanSlot));
    if (isEngineSlotLinked(slotState)) setFeedflowLinked(true);
    refetchEngine();
    const timer = setInterval(() => refetchEngine(), 4000);
    return () => clearInterval(timer);
  }, [scanRow, scanSlot, engineSlots, refetchEngine]);

  async function changeScanSlot(slot) {
    if (!scanRow) return;
    const eng = engineSlots.find((s) => Number(s.slot) === Number(slot));
    if (slot != null && eng?.connected) {
      showToast(`Slot ${slot + 1} is already online — pick a disconnected slot.`);
      return;
    }
    setScanSlot(slot);
    try {
      // Disconnected slots are reusable — free any other AMS row still pointing here.
      if (slot != null) {
        const previous = allAccounts.filter(
          (a) => a.id !== scanRow.id && a.wsaf_slot != null && Number(a.wsaf_slot) === Number(slot),
        );
        await Promise.all(
          previous.map((a) =>
            patchAccount.mutateAsync({
              id: a.id,
              row: a,
              patch: { wsaf_slot: null },
              extra: { wsaf_slot: null },
            }).catch(() => {}),
          ),
        );
        await clearSlotDisplayLabel(slot).catch(() => {});
      }
      await patchAccount.mutateAsync({
        id: scanRow.id,
        row: scanRow,
        patch: { wsaf_slot: slot },
        extra: { wsaf_slot: slot },
      });
    } catch (e) {
      showToast(e.message || 'Could not save engine slot');
    }
  }

  async function submitScan() {
    if (!scanRow || busy) return;
    if (!scanOk) {
      showToast(toastCopy.nurturingConfirmIp());
      return;
    }
    if (scanSlot == null) {
      showToast('Assign an engine slot and link FeedFlow before scan-in.');
      return;
    }
    if (!feedflowLinked) {
      showToast('Link WhatsApp in FeedFlow before confirming scan-in.');
      return;
    }
    setBusy(true);
    try {
      const ipRow = freeIps.find((ip) => ip.id === scanIpId);
      const nextIp = ipRow?.ip_address || scanRow.ip;
      await patchAccount.mutateAsync({
        id: scanRow.id,
        row: scanRow,
        patch: {
          ip: nextIp,
          ip_id: ipRow?.id || null,
          nurturing_phase: 'auto',
          linked_override: true,
          wsaf_slot: scanSlot,
        },
        extra: { wsaf_slot: scanSlot },
      });

      let proxySyncFailed = false;
      const proxyUrl = proxyUrlFromIp(ipRow);
      if (proxyUrl && scanSlot != null) {
        try {
          await syncSlotProxyToEngine(scanSlot, proxyUrl);
          await syncSlotDisplayLabelToEngine(
            scanSlot,
            feedflowSlotLabelBody({
              ...scanRow,
              account_name: scanRow.acct || scanRow.account_name,
              ip: nextIp,
            }),
          ).catch(() => {});
        } catch {
          proxySyncFailed = true;
        }
      }

      setScanRow(null);
      showToast(
        proxySyncFailed
          ? `${toastCopy.nurturingScanIn(scanRow.acct)} — FeedFlow proxy sync failed; set manually in engine settings.`
          : toastCopy.nurturingScanIn(scanRow.acct),
      );
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
      await syncOutcomeToFeedingAudit(banRow, FEEDING_STATUS.BANNED);
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
      await syncOutcomeToFeedingAudit(row, FEEDING_STATUS.BANNED);
      showToast(toastCopy.nurturingBanned(row.acct));
      navigate('/recovery');
    } catch (e) {
      showToast(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  /** Strict/restrict — stay nurturing, demote to manual scan-in (can re-link). */
  async function markStrict(row) {
    if (busy) return;
    setBusy(true);
    try {
      // Day 3 ready: started_at = now − 2 days so isManualScanDue is true.
      const startedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const patch = {
        nurturing_phase: 'manual',
        nurturing_started_at: startedAt,
        human_note: 'Strict / restricted — rescan required',
      };
      await patchAccount.mutateAsync({ id: row.id, row, patch });
      await syncOutcomeToFeedingAudit(row, FEEDING_STATUS.RESTRICT);
      showToast(toastCopy.nurturingStrict(row.acct));
      openScan({ ...row, ...patch, day: 3 });
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
        reason: 'Nurturing complete — ready for delivery',
      });
      // Free engine slot so a new nurturing account can reuse it (no need to keep adding pairs).
      if (row.wsaf_slot != null) {
        await patchAccount.mutateAsync({
          id: row.id,
          row,
          patch: { wsaf_slot: null },
          extra: { wsaf_slot: null },
        }).catch(() => {});
      }
      showToast(toastCopy.nurturingGraduated(row.acct));
    } catch (e) {
      showToast(e.message || 'Graduation failed');
    } finally {
      setBusy(false);
    }
  }

  const scanAccount = useMemo(() => (
    scanRow
      ? {
        ...scanRow,
        account_name: scanRow.acct || scanRow.account_name,
        phone_number: scanRow.phone_number,
      }
      : null
  ), [scanRow]);

  return (
    <div>
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
                        <IconTooltip label="Mark strict">
                          <button
                            type="button"
                            className="table-icon-btn table-icon-btn--accent"
                            onClick={() => markStrict(row)}
                            aria-label="Mark strict"
                          >
                            <AlertTriangle size={15} strokeWidth={2} />
                          </button>
                        </IconTooltip>
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
                // Disconnect = live engine slot, not Feeding audit status.
                const linkState = liveSlotConnection(row, engineSlots);
                const offline = linkState === 'offline';
                let statusLabel = NURT_STATUS.auto;
                let statusClass = 'badge-accent';
                if (offline) {
                  statusLabel = NURT_STATUS.offline;
                  statusClass = 'badge-default';
                } else if (gradDue) {
                  statusLabel = 'Ready for standby';
                  statusClass = 'badge-success';
                }
                return (
                  <tr key={row.id}>
                    <td className="font-semibold text-ams-blue">{row.acct}</td>
                    <td className="col-mono">{row.dev} · {row.ch}</td>
                    <td className="col-center">
                      <ProgressBar day={row.day} max={7} tone="blue" />
                    </td>
                    <td className="col-center">
                      <span className={`badge ${statusClass}`} title={offline ? 'FeedFlow slot disconnected' : undefined}>
                        {statusLabel}
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
                          <IconTooltip label="Mark nurturing complete">
                            <button
                              type="button"
                              className="table-icon-btn table-icon-btn--success"
                              onClick={() => graduate(row)}
                              aria-label="Mark nurturing complete"
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
                        <IconTooltip label="Mark strict">
                          <button
                            type="button"
                            className="table-icon-btn table-icon-btn--accent"
                            onClick={() => markStrict(row)}
                            aria-label="Mark strict"
                          >
                            <AlertTriangle size={15} strokeWidth={2} />
                          </button>
                        </IconTooltip>
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
            <button
              type="button"
              className="btn btn-secondary btn-scan-confirm"
              onClick={submitScan}
              disabled={busy}
              title={
                !scanOk
                  ? 'Tick “Device farm complete…” first'
                  : scanSlot == null
                    ? 'Assign a FeedFlow slot first'
                    : !feedflowLinked
                      ? 'Finish WhatsApp QR/link until the slot is online'
                      : 'Confirm scan-in'
              }
            >
              {busy ? 'Saving…' : 'Confirm Auto Nurturing'}
            </button>
          </>
        )}
      >
        {scanRow && (
          <div className="drawer-form scan-drawer-form">
            <p className="drawer-hint drawer-hint--compact">
              Day 3 on device farm — pick proxy, link FeedFlow, then confirm scan-in. Proxy is pushed to FeedFlow automatically (no manual Settings → Proxy).
            </p>

            <div className="drawer-summary-card">
              <div className="drawer-kv-grid">
                <span className="drawer-kv-k">Account</span>
                <span className="drawer-kv-v drawer-kv-v--name">{scanRow.acct}</span>
                <span className="drawer-kv-k">Device</span>
                <span className="drawer-kv-v">{scanRow.dev} · {scanRow.ch}</span>
                <span className="drawer-kv-k">Site</span>
                <span className="drawer-kv-v drawer-kv-v--plain">{SITES[scanRow.siteKey].name}</span>
              </div>
            </div>

            <section className="drawer-section">
              <div className="drawer-section-title">Engine proxy</div>
              <select
                className="input font-mono text-sm"
                value={scanIpId}
                onChange={(e) => setScanIpId(e.target.value)}
              >
                {freeIps.length === 0 ? (
                  <option value="">No active IPs in ledger</option>
                ) : freeIps.map((ip) => {
                  const bound = ipBindingCount(ip, ipBindings);
                  const selectable = isIpSelectableForAccount(ip, ipBindings, scanRow.ip_id);
                  const suffix = proxyBindingSuffix(bound, scanRow.ip_id, ip.id);
                  return (
                    <option key={ip.id} value={ip.id} disabled={!selectable}>
                      {formatProxyOptionLabel(ip)}{suffix}
                    </option>
                  );
                })}
              </select>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title">FeedFlow link</div>
              <LinkWhatsAppDrawer
                embedded
                hideAccountRow
                open={!!scanRow}
                account={scanAccount}
                slot={scanSlot}
                engineSlots={engineSlots}
                slotTakenBy={slotTakenBy}
                engineReachable={engineReachable}
                engineStatus={engineData}
                onEngineRefresh={refetchEngine}
                onSlotChange={changeScanSlot}
                proxyUrl={scanProxyUrl}
                requireProxy
                onLinked={async () => {
                  setFeedflowLinked(true);
                  await patchAccount.mutateAsync({
                    id: scanRow.id,
                    row: scanRow,
                    patch: { linked_override: true, wsaf_slot: scanSlot },
                    extra: { wsaf_slot: scanSlot },
                  });
                }}
              />
            </section>

            <label className={`scan-drawer-confirm flex items-start gap-2.5 text-[13px] ${scanOk ? 'text-ams-muted' : 'text-ams-warn'}`}>
              <input
                type="checkbox"
                className="ams-check mt-0.5 shrink-0"
                checked={scanOk}
                onChange={(e) => setScanOk(e.target.checked)}
              />
              <span>
                Device farm complete — ready for engine monitoring
                {!scanOk ? ' (required to confirm)' : ''}
              </span>
            </label>
            {(scanSlot == null || !feedflowLinked) && (
              <p className="text-[11px] leading-relaxed text-ams-warn">
                {scanSlot == null
                  ? 'Assign a FeedFlow slot and link WhatsApp before confirming.'
                  : 'Waiting for FeedFlow slot online after QR scan — Confirm unlocks when Connected.'}
              </p>
            )}
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
