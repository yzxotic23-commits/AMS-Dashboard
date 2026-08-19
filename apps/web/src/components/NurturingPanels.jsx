import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, Clock, ScanLine } from 'lucide-react';
import Drawer from './Drawer';
import DetailDialog from './DetailDialog';
import IconTooltip from './IconTooltip';
import Toast from './Toast';
import LinkWhatsAppDrawer from './LinkWhatsAppDrawer';
import ProxyIpPicker from './ProxyIpPicker';
import { useSite } from '../context/SiteContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { useAccountsByStatus, useAccountMutations, useAllAccounts } from '../hooks/useOperatorAccounts';
import { useFreeIps } from '../hooks/useResourceOptions';
import {
  isAutoGraduationDue, isManualScanDue, nurturingDay,
} from '../lib/nurturing-day';
import { NURT_STATUS, toastCopy } from '../lib/operator-copy';
import { proxyUrlFromIp } from '../lib/proxy-display';
import {
  CURRENT_STATUS,
  FEEDING_STATUS,
  feedflowSlotLabelBody,
  nurturingOutcomeAuditPayload,
} from '../lib/feeding-audit';
import { buildSlotTakenByMap, liveSlotConnection } from '../lib/engine-slot';
import {
  clearSlotDisplayLabel,
  isEngineSlotLinked,
  recordFeedingAuditEntry,
  syncSlotDisplayLabelToEngine,
  syncSlotProxyToEngine,
} from '../lib/bridge-client';
import { buildIpBindings } from '../lib/ip-ready';

/** FeedFlow Current Status overlays nurturing phase badge when set. */
function nurturingStatusFromRestrict(row) {
  if (row?.restrict_kind === 'restrict_scan') {
    return { label: CURRENT_STATUS.RESTRICTED_SCAN, className: 'badge-warn' };
  }
  if (row?.restrict_kind === 'restrict_chat_new') {
    return { label: CURRENT_STATUS.RESTRICTED_CHAT_NEW, className: 'badge-warn' };
  }
  return null;
}

const PROGRESS_FILL_CLASS = {
  warn: 'nurt-progress-fill nurt-progress-fill--warn',
  ok: 'nurt-progress-fill nurt-progress-fill--ok',
  blue: 'nurt-progress-fill nurt-progress-fill--blue',
};

function ProgressBar({ day, max, tone = 'warn' }) {
  const pct = Math.min(100, Math.round((day / max) * 100));
  const label = day > max ? `Day ${day}` : `Day ${day}/${max}`;
  return (
    <div className="nurt-progress">
      <div className="nurt-progress-track">
        <div className={PROGRESS_FILL_CLASS[tone] || PROGRESS_FILL_CLASS.warn} style={{ width: `${pct}%` }} />
      </div>
      <span className="nurt-progress-label" title={day > max ? `Extended past SOP day ${max}` : undefined}>
        {label}
      </span>
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

/** Operator Strict subtypes — two WA restriction modes. */
const STRICT_KINDS = [
  {
    id: 'restrict_scan',
    label: 'Restricted Scan',
    hint: 'Cannot scan / re-link WhatsApp during the restriction period. Demote to device-farm scan-in for later recovery.',
  },
  {
    id: 'restrict_chat_new',
    label: 'Restricted Chat New Contact',
    hint: 'Can still scan / stay linked, but chat is limited to existing contacts only (no new contacts).',
  },
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
  const [strictRow, setStrictRow] = useState(null);
  const [strictKind, setStrictKind] = useState('restrict_scan');
  const [scanIpId, setScanIpId] = useState('');
  const [scanOk, setScanOk] = useState(false);
  const [scanSlot, setScanSlot] = useState(null);
  const [feedflowLinked, setFeedflowLinked] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { data: nurturing = [], isLoading } = useAccountsByStatus('NURTURING');
  const { data: allAccounts = [] } = useAllAccounts();
  const { patchAccount, transitionAccount, banAccount, markStrict } = useAccountMutations();
  const { data: engineData, refetch: refetchEngine } = useEngineStatus();

  /** Mirror operator Strict/Banned into FeedFlow feeding audit (needs wsaf_slot). */
  async function syncOutcomeToFeedingAudit(row, feedingStatus, opts = {}) {
    if (row?.wsaf_slot == null) return;
    try {
      await recordFeedingAuditEntry(nurturingOutcomeAuditPayload(row, feedingStatus, opts));
      qc.invalidateQueries({ queryKey: ['bridge', 'audit'] });
    } catch {
      /* engine offline — nurturing action already succeeded */
    }
  }

  function openStrict(row) {
    setStrictRow(row);
    setStrictKind('restrict_scan');
  }

  function closeStrict() {
    if (busy) return;
    setStrictRow(null);
    setStrictKind('restrict_scan');
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

  const ipBindings = useMemo(() => buildIpBindings(allAccounts), [allAccounts]);

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
    const slot = row.wsaf_slot ?? null;
    // Default like desktop: no AMS proxy (phone Shadowrocket). Operator can still pick a ledger IP.
    setScanIpId('');
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
      // Engine proxy is optional. Never write ip_id: null — ledger IP stays the registration bind.
      const nextIpId = ipRow?.id || scanRow.ip_id || scanRow.reference_ip_id || null;
      const nextIp = ipRow?.ip_address || scanRow.ip || scanRow.reference_ip_address || '';
      await patchAccount.mutateAsync({
        id: scanRow.id,
        row: scanRow,
        patch: {
          nurturing_phase: 'auto',
          linked_override: true,
          wsaf_slot: scanSlot,
          ...(nextIpId ? { ip: nextIp, ip_id: nextIpId } : {}),
        },
        extra: {
          wsaf_slot: scanSlot,
          ...(ipRow?.id ? { ip_id: ipRow.id } : {}),
        },
      });

      let proxySyncFailed = false;
      // Only the Engine proxy the operator picked here is pushed to FeedFlow.
      // Empty = phone Shadowrocket / direct — never copy the register IP into Settings.
      const engineProxyUrl = proxyUrlFromIp(ipRow) || 'direct';
      if (scanSlot != null) {
        try {
          await syncSlotProxyToEngine(scanSlot, engineProxyUrl);
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

  /**
   * Strict/restrict subtypes — writes AMS Audit Log + Feeding Log via API.
   * - Restricted Scan → cannot scan during restriction; demote to manual
   * - Restricted Chat New Contact → scan OK; chat limited to existing contacts
   */
  async function confirmStrict() {
    if (!strictRow || busy) return;
    const row = strictRow;
    const kind = strictKind;
    setBusy(true);
    try {
      const result = await markStrict.mutateAsync({ id: row.id, kind });
      const base = kind === 'restrict_chat_new'
        ? toastCopy.nurturingStrictChatNew(row.acct)
        : toastCopy.nurturingStrictScan(row.acct);
      if (result?.strict?.feedingAudit === false) {
        showToast(`${base} · AMS Audit OK · Feeding Log offline`);
      } else {
        showToast(`${base} · AMS Audit + Feeding Log`);
      }
      setStrictRow(null);
      setStrictKind('restrict_scan');
    } catch (e) {
      showToast(e?.response?.data?.error || e.message || 'Update failed');
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
                const restrictStatus = nurturingStatusFromRestrict(row);
                const statusLabel = restrictStatus?.label
                  || (due ? NURT_STATUS.readyScan : NURT_STATUS.manual);
                const statusClass = restrictStatus?.className || 'badge-warn';
                return (
                  <tr key={row.id}>
                    <td className="font-semibold text-ams-blue">{row.acct}</td>
                    <td className="col-mono">{row.dev} · {row.ch}</td>
                    <td className="col-center">
                      <ProgressBar day={row.day} max={3} tone="warn" />
                    </td>
                    <td className="col-center">
                      <span className={`badge ${statusClass}`}>
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
                            onClick={() => openStrict(row)}
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
        <h3>Auto nurturing (day 4+ · engine monitored)</h3>
        <p className="text-[11px] text-ams-faint">
          SOP target day 7 — accounts can stay longer (extended nurture). Graduate to Ready manually when deliverable.
        </p>
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
                const restrictStatus = nurturingStatusFromRestrict(row);
                let statusLabel = NURT_STATUS.auto;
                let statusClass = 'badge-accent';
                if (restrictStatus) {
                  statusLabel = restrictStatus.label;
                  statusClass = restrictStatus.className;
                } else if (offline) {
                  statusLabel = NURT_STATUS.offline;
                  statusClass = 'badge-default';
                } else if (gradDue) {
                  statusLabel = row.day > 7 ? `Extended · Day ${row.day}` : 'Ready for standby';
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
                            onClick={() => openStrict(row)}
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
              Day 3 on device farm — link FeedFlow, then confirm scan-in. Engine proxy is optional
              (same as desktop): leave empty if the phone already uses Shadowrocket; pick a ledger IP
              only when you want AMS SOCKS on the engine.
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
              <div className="drawer-section-title">Engine proxy <span className="font-normal text-ams-muted">(optional)</span></div>
              <ProxyIpPicker
                ips={freeIps}
                bindings={ipBindings}
                value={scanIpId}
                accountIpId={scanRow.ip_id}
                onChange={setScanIpId}
                allowEmpty
                emptyLabel="Phone / direct (Shadowrocket)"
              />
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

      <DetailDialog
        open={!!strictRow}
        title="Mark Strict"
        onClose={closeStrict}
        cardClassName="max-w-md"
        footer={(
          <>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeStrict}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !strictKind}
              onClick={confirmStrict}
            >
              {busy ? 'Saving…' : 'Confirm Strict'}
            </button>
          </>
        )}
      >
        {strictRow && (
          <div className="space-y-4">
            <p className="text-[12.5px] leading-relaxed text-ams-muted">
              Choose the restriction type shown on the phone / WhatsApp. Saved to
              AMS Audit Log and Feeding Log (Restrict).
            </p>
            <div className="rounded-lg border border-ams-line bg-ams-surface-muted px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-ams-faint">Account</div>
              <div className="text-sm font-semibold text-ams-ink">{strictRow.acct}</div>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[12px] font-semibold text-ams-ink">Restriction type</legend>
              {STRICT_KINDS.map((opt) => {
                const selected = strictKind === opt.id;
                return (
                  <label
                    key={opt.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-[13px] ${
                      selected
                        ? 'border-ams-accent bg-ams-accent/5 text-ams-ink'
                        : 'border-ams-line bg-ams-surface text-ams-muted hover:border-ams-accent/40'
                    }`}
                  >
                    <input
                      type="radio"
                      className="ams-check mt-0.5 shrink-0"
                      name="strict-kind"
                      value={opt.id}
                      checked={selected}
                      disabled={busy}
                      onChange={() => setStrictKind(opt.id)}
                    />
                    <span>
                      <span className="block font-semibold text-ams-ink">{opt.label}</span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-ams-muted">
                        {opt.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </div>
        )}
      </DetailDialog>

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
