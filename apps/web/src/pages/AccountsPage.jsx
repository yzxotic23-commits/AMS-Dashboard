import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import PageHead from '../components/PageHead';
import DetailDialog from '../components/DetailDialog';
import Drawer from '../components/Drawer';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import SegControl from '../components/SegControl';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useAllAccounts, useAccountDetail, useAccountMutations } from '../hooks/useOperatorAccounts';
import { usePhoneSyncMutation } from '../hooks/useSupply';
import { toastCopy } from '../lib/operator-copy';
import { statusMeta, resolveAccountBrand, BRAND_OPTIONS } from '../lib/account-status-labels';
import {
  compareDeviceNames,
  displayDeviceChannel,
  channelSlotIndex,
  groupAccountsByDeviceSlots,
  DEVICE_MAX_SLOTS,
} from '../lib/device-location';
import { filterDevicesBySite } from '../lib/resource-mappers';
import { nurturingDay, nurturingProgress } from '../lib/nurturing-day';
import { buildAccountPath, historyRowCaption } from '../lib/nurture-history';
import { getBridgeSummary } from '../lib/bridge-client';
import { liveSlotConnection } from '../lib/engine-slot';
import { profileStaffScope, accountInStaffScope } from '../lib/account-staff';
import { ledgerIp } from '../lib/account-operator-meta';
import {
  accountTypeLabel,
  isBrandSharedAccount,
  ACCOUNT_TYPE_BRAND_SHARED,
  ACCOUNT_TYPE_PERSONAL,
} from '../lib/account-type';
import {
  collectAnomalyEvents,
  eventLogoutAt,
  stageLabel,
  anomalyStatusLabel,
} from '../lib/anomaly-event';
import api from '../lib/api';

function staffDisplay(account) {
  if (isBrandSharedAccount(account)) return accountTypeLabel(ACCOUNT_TYPE_BRAND_SHARED);
  return account?.staff || '—';
}

const STAFF_FILTER_UNASSIGNED = '__unassigned__';
const STAFF_FILTER_SHARED = accountTypeLabel(ACCOUNT_TYPE_BRAND_SHARED);

function staffAssignmentKey(account) {
  if (isBrandSharedAccount(account)) return STAFF_FILTER_SHARED;
  const name = String(account?.staff || '').trim();
  return name || STAFF_FILTER_UNASSIGNED;
}

function staffAssignmentLabel(key) {
  return key === STAFF_FILTER_UNASSIGNED ? 'Unassigned' : key;
}

const MISSING_BRAND = '-';

function ledgerBrandLabel(account) {
  const brand = resolveAccountBrand(account) || String(account?.brand || '').trim().toUpperCase();
  return brand || MISSING_BRAND;
}

function isMissingBrand(brand) {
  return !brand || brand === '-' || brand === '—';
}

function accountMatchesStaffFilter(account, fStaff) {
  if (!fStaff) return true;
  return staffAssignmentKey(account) === fStaff;
}

function accountInLedgerSite(account, site) {
  if (site === 'all') return true;
  return account.siteKey === site || account.siteKey === 'all';
}

const STAFF_SUMMARY_PAGE_SIZE = 8;

function StaffAssignmentSummary({ rows, total, selectedStaff, selectedBrand, onSelect }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / STAFF_SUMMARY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length ? (safePage - 1) * STAFF_SUMMARY_PAGE_SIZE : 0;
  const pageRows = rows.slice(pageStart, pageStart + STAFF_SUMMARY_PAGE_SIZE);
  const pageEnd = Math.min(pageStart + pageRows.length, rows.length);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (!rows.length && total === 0) return null;
  return (
    <div className="rl-staff-summary">
      <div className="rl-staff-summary-head">
        <p className="rl-staff-summary-title">Staff assignment</p>
        <p className="rl-staff-summary-hint">Click a row to filter the ledger by staff and brand</p>
      </div>
      <div className="data-table-wrap rl-staff-summary-table">
        <table className="data-table data-table--staff-summary">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Brand</th>
              <th className="col-center">Accounts</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const selected = selectedStaff === row.staffKey
                && (!selectedBrand || selectedBrand === row.brand);
              return (
                <tr
                  key={`${row.staffKey}::${row.brand}`}
                  role="button"
                  tabIndex={0}
                  className={selected ? 'row-selected' : undefined}
                  aria-pressed={selected}
                  onClick={() => onSelect(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(row);
                    }
                  }}
                >
                  <td>
                    <span className={row.staffKey === STAFF_FILTER_UNASSIGNED && row.count > 0
                      ? 'rl-staff-summary-unassigned'
                      : undefined}
                    >
                      {row.label}
                    </span>
                  </td>
                  <td className="text-ams-muted">{row.brand}</td>
                  <td className="col-center font-semibold tabular-nums">{row.count}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>Total</th>
              <th className="col-center tabular-nums">{total}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > STAFF_SUMMARY_PAGE_SIZE && (
        <div className="tk-pager rl-staff-summary-pager">
          <p className="tk-pager-meta">
            Showing {pageStart + 1}–{pageEnd} of {rows.length} rows
          </p>
          <div className="tk-pager-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </button>
            <span className="tk-pager-page">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const LEDGER_PAGE_SIZE = 5;
const BUSINESS_PAGE_SIZE = 10;

function siteChipLabel(siteKey) {
  if (siteKey === 'all') return 'All';
  return SITES[siteKey]?.name || siteKey;
}

function StatusPill({ status, note, restrictKind, pendingConfirmation }) {
  if (pendingConfirmation) {
    return (
      <span className="badge badge-warn" title="Keep-alive session dropped — awaiting resource confirmation">
        Pending confirmation
      </span>
    );
  }
  if (restrictKind) {
    const restriction = restrictionMeta(restrictKind);
    return (
      <span className={`badge ${restriction.pill}`} title={restriction.label}>
        {restriction.label}
      </span>
    );
  }
  const meta = statusMeta(status);
  return (
    <span className={`badge ${meta.pill}`}>
      {meta.label}
      {note ? <span className="rl-status-note"> · {note}</span> : null}
    </span>
  );
}

function matchesLedgerStatusFilter(account, fSt) {
  if (!fSt) return true;
  if (fSt === 'restricted') return Boolean(account.restrict_kind);
  if (fSt === 'inuse' && account.restrict_kind) return false;
  return statusMeta(account.status).filter === fSt;
}

function HistoryPills({ event }) {
  const cap = historyRowCaption(event);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {cap.fromLabel ? (
        <span className="badge badge-warn">{cap.fromLabel}</span>
      ) : cap.fromStatus ? (
        <StatusPill status={cap.fromStatus} />
      ) : null}
      {(cap.fromLabel || cap.fromStatus) && <span className="text-ams-faint">→</span>}
      {cap.toLabel ? (
        <span className="badge badge-warn">{cap.toLabel}</span>
      ) : (
        <StatusPill status={cap.toStatus} />
      )}
    </div>
  );
}

function HistoryEventItem({ event }) {
  return (
    <li className="rounded-lg border border-ams-line px-3 py-2.5 text-[13px]">
      <HistoryPills event={event} />
      {event.reason && (
        <p className="mt-1.5 text-ams-muted">{event.reason}</p>
      )}
      <p className="mt-1 text-[11px] text-ams-faint">
        {event.profiles?.full_name || 'System'}
        {' · '}
        {new Date(event.changed_at).toLocaleString()}
      </p>
    </li>
  );
}

const USAGE_ACTION_META = {
  request: { label: 'Request', pill: 'badge-accent' },
  confirm: { label: 'Confirm live', pill: 'badge-success' },
  disconnect_report: { label: 'Disconnect report', pill: 'badge-warn' },
  return_standby: { label: 'Return to Standby', pill: 'badge-default' },
  go_live: { label: 'Go live', pill: 'badge-accent' },
};

function usageActionMeta(action) {
  const key = String(action || '').trim().toLowerCase();
  return USAGE_ACTION_META[key] || {
    label: key ? key.replace(/_/g, ' ') : 'Event',
    pill: 'badge-default',
  };
}

function formatUsageWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const USAGE_PREVIEW = 4;
const USAGE_PAGE_SIZE = 5;

function UsageHistoryTable({ events, compact = false }) {
  const [page, setPage] = useState(1);
  const pageSize = compact ? USAGE_PREVIEW : USAGE_PAGE_SIZE;

  useEffect(() => {
    setPage(1);
  }, [events.length, compact, pageSize]);

  const totalPages = Math.max(1, Math.ceil(events.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const rows = events.slice(start, start + pageSize);
  const pageStart = events.length ? start + 1 : 0;
  const pageEnd = Math.min(start + pageSize, events.length);
  const showPager = events.length > pageSize;

  return (
    <div>
      <div className={compact ? '' : 'overflow-hidden rounded-lg border border-ams-line'}>
        <div className="grid grid-cols-[9rem_minmax(0,1fr)_7.5rem] items-center gap-x-3 border-b border-ams-line bg-ams-surface-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ams-faint sm:grid-cols-[10rem_minmax(0,1fr)_8.5rem]">
          <span>Type</span>
          <span>Staff</span>
          <span className="text-right">When</span>
        </div>
        <ul>
          {rows.map((ev) => (
            <UsageEventItem key={ev.id} event={ev} fullWhen={!compact} />
          ))}
        </ul>
      </div>
      {showPager ? (
        <div className={`tk-pager ${compact ? 'mt-0 border-t border-ams-line px-3 py-2.5' : 'mt-3'}`}>
          <p className="tk-pager-meta text-center sm:text-left">
            Showing {pageStart}–{pageEnd} of {events.length} events
          </p>
          <div className="tk-pager-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </button>
            <span className="tk-pager-page">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UsageEventItem({ event, fullWhen = false }) {
  const meta = usageActionMeta(event.action);
  return (
    <li className="grid grid-cols-[9rem_minmax(0,1fr)_7.5rem] items-center gap-x-3 border-b border-ams-line px-3 py-2.5 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)_8.5rem]">
      <span className={`badge ${meta.pill} w-fit max-w-full truncate`}>{meta.label}</span>
      <span className="truncate text-[13px] font-semibold text-ams-ink">
        {event.actor_name || '—'}
      </span>
      <time
        className="text-right text-[12px] tabular-nums text-ams-muted"
        title={event.occurred_at ? new Date(event.occurred_at).toLocaleString() : undefined}
      >
        {fullWhen && event.occurred_at
          ? new Date(event.occurred_at).toLocaleString()
          : formatUsageWhen(event.occurred_at)}
      </time>
    </li>
  );
}

function NurtureTimeline({ account, history, tickets, compact = false }) {
  const all = buildAccountPath(account, history, tickets);
  if (!all.length) return null;
  const PATH_PREVIEW = 4;
  const hidden = compact && all.length > PATH_PREVIEW ? all.length - PATH_PREVIEW : 0;
  const steps = hidden ? all.slice(-PATH_PREVIEW) : all;
  return (
    <div className="mb-4 rounded-lg border border-ams-line bg-ams-canvas/60 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ams-faint">Account path</p>
      {hidden > 0 && (
        <p className="mt-1 text-[11px] text-ams-faint">
          Showing latest {PATH_PREVIEW} of {all.length} stages — open Full history for the rest
        </p>
      )}
      <ol className="mt-2 space-y-2" start={hidden + 1}>
        {steps.map((step, i) => (
          <li key={step.key} className="flex gap-2 text-[13px]">
            <span className="mt-0.5 w-4 shrink-0 text-[11px] font-semibold text-ams-faint">{hidden + i + 1}.</span>
            <div className="min-w-0">
              <p className="font-semibold text-ams-ink">
                {step.title}
                {step.duration ? (
                  <span className="ml-1 font-medium text-ams-accent">· {step.duration}</span>
                ) : null}
                {step.ongoing ? (
                  <span className="ml-1 text-[11px] font-medium text-ams-warn">now</span>
                ) : null}
              </p>
              <p className="text-[11px] text-ams-faint">
                {new Date(step.from).toLocaleString()}
                {step.to && !step.ongoing ? ` → ${new Date(step.to).toLocaleString()}` : ''}
                {step.note ? ` · ${step.note}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** WA-level restriction overlay (set via operator "Mark Strict") — separate from account.status. */
function restrictionMeta(kind) {
  if (kind === 'restrict_scan') {
    return { label: 'Restricted Scan', short: 'Restrict scan', pill: 'badge-warn' };
  }
  if (kind === 'restrict_chat_new') {
    return { label: 'Restricted Chat New Contact', short: 'Restrict chat', pill: 'badge-warn' };
  }
  return { label: 'Active', short: 'Active', pill: 'badge-success' };
}

function EmptySlotRow({ slotLabel }) {
  return (
    <div className="rl-acct-row empty">
      <div className="rl-col-acct">
        <span className="rl-slot-label">{slotLabel}</span>
        <span className="text-[12px] text-ams-faint">Empty slot</span>
      </div>
      <div className="text-[12px] text-ams-faint">—</div>
      <div className="font-mono text-[12px] text-ams-faint">—</div>
      <div className="font-mono text-[12px] text-ams-faint">—</div>
      <div className="text-[12.5px] text-ams-faint">—</div>
      <div className="rl-col-staff text-ams-faint">—</div>
    </div>
  );
}

function AcctRow({ account, onOpen, showSiteBubble = false, slotLabel, extra = false }) {
  const day = account.status === 'NURTURING'
    ? nurturingDay(account.nurturing_started_at, account.nurturing_phase)
    : null;
  const dayNote = day != null
    ? `${day}/${account.nurturing_phase === 'manual' ? 3 : 7}`
    : null;

  const siteTag = showSiteBubble && account.siteKey && account.siteKey !== 'all'
    ? account.siteKey
    : null;

  const flag = account.disconnect_report
    ? { text: 'Pending confirmation', title: 'Keep-alive dropped — resource team is verifying Banned vs Restrict' }
    : null;

  return (
    <div className={`rl-acct-row${siteTag ? ` rl-acct-row--site-${siteTag}` : ''}${extra ? ' rl-acct-row--extra' : ''}`}>
      <div className="rl-col-acct">
        <span className="rl-slot-label">
          {slotLabel || displayDeviceChannel(account.channel) || '—'}
        </span>
        {extra && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ams-warn">
            Extra · perlu dipindah
          </span>
        )}
        {siteTag ? (
          <div className="rl-acct-name-row">
            <button type="button" className="rl-acct-name" onClick={() => onOpen(account)}>
              {account.account_name}
            </button>
            <span className={`rl-site-tag rl-site-tag--${siteTag}`}>
              {SITES[siteTag].short}
            </span>
          </div>
        ) : (
          <button type="button" className="rl-acct-name" onClick={() => onOpen(account)}>
            {account.account_name}
          </button>
        )}
      </div>
      <div className="rl-col-status">
        <StatusPill
          status={account.status}
          note={dayNote}
          restrictKind={account.restrict_kind}
          pendingConfirmation={Boolean(account.disconnect_report)}
        />
        {flag && (
          <span className="rl-flag-chip" title={flag.title}>{flag.text}</span>
        )}
      </div>
      <div className="font-mono text-[12px]">{account.phone_number || '—'}</div>
      <div className="font-mono text-[12px]">{ledgerIp(account) || '—'}</div>
      <div className="text-[12.5px] text-ams-muted">{resolveAccountBrand(account) || '—'}</div>
      <div className="rl-col-staff">{staffDisplay(account)}</div>
    </div>
  );
}

const RESOLVE_OUTCOMES = [
  ['restrict_scan', 'Restrict — Scan'],
  ['restrict_chat_new', 'Restrict — Chat New Contact'],
  ['banned', 'Banned'],
  ['false_positive', 'False positive / monitoring interruption'],
  ['logged_out', 'Logged out (not ban)'],
];

const STANDBY_RESTRICT_KINDS = [
  {
    id: 'restrict_scan',
    label: 'Restricted Scan',
    hint: 'Cannot scan / re-link WhatsApp during the restriction period.',
  },
  {
    id: 'restrict_chat_new',
    label: 'Restricted Chat New Contact',
    hint: 'Can still scan; chat limited to existing contacts only.',
  },
];

const STANDBY_BAN_REASONS = [
  'Banned on phone — platform review / Recovery',
  'Number rejected by platform',
  'Verification failed',
  'Device / SIM issue',
  'Other',
];

function AccountDetail({ accountId, onBack, staffOptions = [] }) {
  const { profile } = useAuth();
  const isBusinessUser = profile?.role === 'business';
  const { data: account, isLoading, isError, error } = useAccountDetail(accountId);
  const {
    patchAccount, reportDisconnect, resolveDisconnect, returnStandby, ackNotice,
    banAccount, markStrict,
  } = useAccountMutations();
  const unlinkSimMut = usePhoneSyncMutation();
  const canSetStaff = profile?.role === 'admin' || profile?.role === 'operator';
  const [staffDraft, setStaffDraft] = useState('');
  const [typeDraft, setTypeDraft] = useState(ACCOUNT_TYPE_PERSONAL);
  const [staffToast, setStaffToast] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportToast, setReportToast] = useState('');
  const [resolveOutcome, setResolveOutcome] = useState('restrict_scan');
  const [resolveReason, setResolveReason] = useState('');
  const [resolveToast, setResolveToast] = useState('');
  const [standbyReason, setStandbyReason] = useState('');
  const [standbyToast, setStandbyToast] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [standbyDrawer, setStandbyDrawer] = useState(null); // 'banned' | 'restrict'
  const [standbyOutcome, setStandbyOutcome] = useState('restrict_scan');
  const [standbyBanReason, setStandbyBanReason] = useState(STANDBY_BAN_REASONS[0]);
  const [standbyUpdateToast, setStandbyUpdateToast] = useState('');
  const [standbyUpdateBusy, setStandbyUpdateBusy] = useState(false);
  const [unlinkSimOpen, setUnlinkSimOpen] = useState(false);
  const [unlinkSimBusy, setUnlinkSimBusy] = useState(false);
  const [unlinkSimToast, setUnlinkSimToast] = useState('');

  const { data: usageEvents = [], isLoading: usageLoading } = useQuery({
    queryKey: ['accounts', 'usage', accountId],
    queryFn: async () => {
      const res = await api.get(`/accounts/${accountId}/usage`, { params: { limit: 80 } });
      return res.data?.data || [];
    },
    enabled: Boolean(accountId) && Boolean(account) && isBrandSharedAccount(account),
  });

  useEffect(() => {
    setStaffDraft(account?.staff || '');
    setTypeDraft(isBrandSharedAccount(account) ? ACCOUNT_TYPE_BRAND_SHARED : ACCOUNT_TYPE_PERSONAL);
  }, [account?.id, account?.staff, account?.account_type]);

  const { data: bridge } = useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: getBridgeSummary,
    staleTime: 20_000,
  });

  const anomalyEvents = useMemo(() => {
    if (!account) return [];
    const list = collectAnomalyEvents({
      disconnect_report: account.disconnect_report,
      anomaly_history: account.anomaly_history,
    });
    return [...list].sort((a, b) => (
      new Date(eventLogoutAt(b) || 0).getTime() - new Date(eventLogoutAt(a) || 0).getTime()
    ));
  }, [account]);

  if (isError) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-ams-warn">{error?.message || 'Account not found'}</p>
        <button type="button" className="btn btn-secondary btn-sm mt-4" onClick={onBack}>‹ Back</button>
      </div>
    );
  }

  if (isLoading || !account) {
    return <p className="py-10 text-center text-sm text-ams-faint">Loading account…</p>;
  }

  const ipMismatch = account.reference_ip_address
    && account.ip
    && account.reference_ip_address !== account.ip;
  const nurture = account.status === 'NURTURING'
    ? nurturingProgress(account.nurturing_started_at, account.nurturing_phase)
    : null;
  const linkState = liveSlotConnection(account, bridge?.slots || []);
  const engineStatus = linkState === 'online'
    ? 'Online'
    : linkState === 'offline'
      ? 'Offline / logged out'
      : (account.status === 'IN_USE' || account.nurturing_phase === 'auto' ? 'Not in engine' : null);
  const lastChecked = bridge?.engine?.lastFeedingComplete?.at
    ? new Date(bridge.engine.lastFeedingComplete.at).toLocaleString()
    : new Date().toLocaleString();

  async function saveStaff() {
    const next = staffDraft.trim();
    if (next === (account.staff || '')) return;
    try {
      await patchAccount.mutateAsync({
        id: account.id,
        row: account,
        patch: { staff: next },
      });
      setStaffToast(next ? `Staff set to ${next}` : 'Staff cleared');
      setTimeout(() => setStaffToast(''), 3200);
    } catch (e) {
      setStaffToast(e.message || 'Failed to save staff');
      setTimeout(() => setStaffToast(''), 4200);
    }
  }

  async function saveAccountType(nextType) {
    const next = nextType === ACCOUNT_TYPE_BRAND_SHARED
      ? ACCOUNT_TYPE_BRAND_SHARED
      : ACCOUNT_TYPE_PERSONAL;
    setTypeDraft(next);
    if (next === (account.account_type || ACCOUNT_TYPE_PERSONAL)) return;
    try {
      await patchAccount.mutateAsync({
        id: account.id,
        row: account,
        patch: { account_type: next },
      });
      setStaffToast(next === ACCOUNT_TYPE_BRAND_SHARED
        ? 'Type set to Brand-wide / Shared'
        : 'Type set to Personal');
      setTimeout(() => setStaffToast(''), 3200);
    } catch (e) {
      setTypeDraft(isBrandSharedAccount(account) ? ACCOUNT_TYPE_BRAND_SHARED : ACCOUNT_TYPE_PERSONAL);
      setStaffToast(e.message || 'Failed to save type');
      setTimeout(() => setStaffToast(''), 4200);
    }
  }

  async function submitReport() {
    try {
      await reportDisconnect.mutateAsync({ id: account.id, note: reportNote.trim() });
      setReportOpen(false);
      setReportNote('');
      setReportToast('Reported — R&M will review and update the status shortly.');
      setTimeout(() => setReportToast(''), 4200);
    } catch (e) {
      setReportToast(e?.response?.data?.error || e.message || 'Failed to report');
      setTimeout(() => setReportToast(''), 4200);
    }
  }

  async function submitResolve() {
    if (!resolveReason.trim()) {
      setResolveToast('Reason is required');
      setTimeout(() => setResolveToast(''), 3200);
      return;
    }
    try {
      await resolveDisconnect.mutateAsync({
        id: account.id,
        outcome: resolveOutcome,
        reason: resolveReason.trim(),
      });
      setResolveReason('');
      setResolveToast('Status updated — business is notified.');
      setTimeout(() => setResolveToast(''), 4200);
    } catch (e) {
      setResolveToast(e?.response?.data?.error || e.message || 'Failed to update status');
      setTimeout(() => setResolveToast(''), 4200);
    }
  }

  async function submitReturnStandby() {
    try {
      await returnStandby.mutateAsync({
        id: account.id,
        reason: standbyReason.trim() || undefined,
      });
      setStandbyReason('');
      setStandbyToast('Returned to Standby — business can request this account again.');
      setTimeout(() => setStandbyToast(''), 4200);
    } catch (e) {
      setStandbyToast(e?.response?.data?.error || e.message || 'Failed to return to Standby');
      setTimeout(() => setStandbyToast(''), 4200);
    }
  }

  async function submitStandbyPhoneUpdate() {
    if (standbyUpdateBusy) return;
    const outcome = standbyDrawer === 'banned' ? 'banned' : standbyOutcome;
    setStandbyUpdateBusy(true);
    try {
      if (outcome === 'banned') {
        await banAccount.mutateAsync({
          id: account.id,
          stage: 'manual',
          reason: standbyBanReason,
          source: 'standby_phone_check',
        });
        setStandbyUpdateToast('Marked Banned — open Recovery to start review.');
      } else {
        await markStrict.mutateAsync({ id: account.id, kind: outcome });
        setStandbyUpdateToast(
          outcome === 'restrict_chat_new'
            ? 'Marked Restricted Chat — hidden from Delivery requests.'
            : 'Marked Restricted Scan — hidden from Delivery requests.',
        );
      }
      setStandbyDrawer(null);
    } catch (e) {
      setStandbyUpdateToast(e?.response?.data?.error || e.message || 'Failed to update status');
    } finally {
      setStandbyUpdateBusy(false);
      setTimeout(() => setStandbyUpdateToast(''), 4200);
    }
  }

  async function clearStandbyRestrict() {
    if (standbyUpdateBusy) return;
    setStandbyUpdateBusy(true);
    try {
      await markStrict.mutateAsync({ id: account.id, kind: 'active' });
      setStandbyUpdateToast('Restriction cleared — requestable on Standby again.');
    } catch (e) {
      setStandbyUpdateToast(e?.response?.data?.error || e.message || 'Failed to clear restriction');
    } finally {
      setStandbyUpdateBusy(false);
      setTimeout(() => setStandbyUpdateToast(''), 4200);
    }
  }

  async function dismissNotice() {
    try {
      await ackNotice.mutateAsync({ id: account.id });
    } catch (e) {
      setReportToast(e?.response?.data?.error || e.message || 'Failed to dismiss');
      setTimeout(() => setReportToast(''), 4200);
    }
  }

  async function confirmUnlinkSim() {
    if (!account.sim_id || unlinkSimBusy) return;
    setUnlinkSimBusy(true);
    try {
      await unlinkSimMut.mutateAsync({
        accountId: account.id,
        action: 'unlink_sim',
        sim_id: account.sim_id,
      });
      setUnlinkSimOpen(false);
      setUnlinkSimToast(toastCopy.accountSimUnlinked(account.sim));
      setTimeout(() => setUnlinkSimToast(''), 4200);
    } catch (e) {
      setUnlinkSimToast(e?.response?.data?.error || e.message || 'Failed to unlink SIM');
      setTimeout(() => setUnlinkSimToast(''), 4200);
    } finally {
      setUnlinkSimBusy(false);
    }
  }

  const restriction = restrictionMeta(account.restrict_kind);
  const statusLabel = account.restrict_kind
    ? restriction.label
    : statusMeta(account.status).label;

  const infoRows = [
    ['Account', account.account_name],
    ['Phone', account.phone_number || '—'],
    ['Channel', displayDeviceChannel(account.channel) || '—'],
    ['Status', statusLabel],
  ];
  if (!isBusinessUser) {
    infoRows.push(['Restriction (WA)', <span className={`badge ${restriction.pill}`}>{restriction.label}</span>]);
  }
  infoRows.push(
    ['Brand', resolveAccountBrand(account) || '—'],
    ['Owner (registered by)', account.owner || '—'],
    ['Device', account.device || '—'],
    ['Site', SITES[account.siteKey]?.name || account.siteKey],
    ['IP (registration)', ledgerIp(account) || '—'],
  );
  if (ipMismatch) {
    infoRows.push(['Current IP (engine)', account.ip || '—']);
  }
  const canUnlinkSim = !isBusinessUser && Boolean(account.sim_id);
  infoRows.push([
    'SIM',
    canUnlinkSim ? (
      <span className="inline-flex items-center justify-end gap-2">
        <span>{account.sim || '—'}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setUnlinkSimOpen(true)}
        >
          Unlink
        </button>
      </span>
    ) : (account.sim || '—'),
  ]);
  if (nurture) infoRows.push(['Nurturing', `Day ${nurture.day}/${nurture.max} · ${nurture.remaining} left`]);
  if (engineStatus) infoRows.push(['Engine status', engineStatus]);

  const canUpdateStandbyPhone = !isBusinessUser
    && (account.status === 'AVAILABLE' || account.status === 'LOGGED_OUT')
    && !account.disconnect_report;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>‹ Back</button>
        <h1 className="text-[22px] font-bold">{account.account_name}</h1>
        <StatusPill status={account.status} restrictKind={account.restrict_kind} />
        {canUpdateStandbyPhone && (
          <div className="ml-auto flex items-center gap-2">
            {account.restrict_kind ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={standbyUpdateBusy || markStrict.isPending}
                onClick={clearStandbyRestrict}
              >
                Clear restriction
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm inline-flex items-center gap-1.5"
                  disabled={standbyUpdateBusy || banAccount.isPending}
                  onClick={() => {
                    setStandbyBanReason(STANDBY_BAN_REASONS[0]);
                    setStandbyDrawer('banned');
                  }}
                >
                  <Ban size={14} strokeWidth={2} />
                  Ban
                </button>
                <button
                  type="button"
                  className="btn btn-outline-warn btn-sm inline-flex items-center gap-1.5"
                  disabled={standbyUpdateBusy || markStrict.isPending}
                  onClick={() => {
                    setStandbyOutcome('restrict_scan');
                    setStandbyDrawer('restrict');
                  }}
                >
                  <AlertTriangle size={14} strokeWidth={2} />
                  Restrict
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {ipMismatch && (
        <div className="mb-4 rounded-lg border border-ams-warn/40 bg-ams-warn/10 px-4 py-3 text-[13px] text-ams-warn">
          IP mismatch: registered with <strong className="font-mono">{account.reference_ip_address}</strong>
          {' '}but currently on <strong className="font-mono">{account.ip}</strong>.
        </div>
      )}

      {engineStatus && (
        <p className="mb-4 text-xs text-ams-faint">
          Engine last checked: {lastChecked} · may lag a few minutes
        </p>
      )}

      {isBusinessUser && account.business_notice?.type === 'returned_standby' && (
        <div className="mb-4 rounded-lg border border-ams-accent/40 bg-ams-accent/10 px-4 py-3">
          <p className="text-[13px] font-semibold text-ams-ink">
            {account.business_notice.title || 'Account status updated'}
          </p>
          {account.business_notice.body ? (
            <p className="mt-1 text-[13px] text-ams-muted">{account.business_notice.body}</p>
          ) : null}
          {account.business_notice.at ? (
            <p className="mt-1 text-[11px] text-ams-faint">
              {new Date(account.business_notice.at).toLocaleString()}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3"
            disabled={ackNotice.isPending}
            onClick={dismissNotice}
          >
            {ackNotice.isPending ? 'Dismissing…' : 'Got it'}
          </button>
        </div>
      )}

      {isBusinessUser && account.disconnect_report && (
          <div className="mb-4 rounded-lg border border-ams-warn/40 bg-ams-warn/10 px-4 py-3 text-[13px] text-ams-warn">
            Pending confirmation — keep-alive dropped
            {' '}
            {new Date(account.disconnect_report.logout_at || account.disconnect_report.reported_at).toLocaleString()}
            {' · '}
            {stageLabel(account.disconnect_report.stage)}
            {' · '}
            disconnect #{account.disconnect_report.disconnect_count || account.disconnect_count || 1}
            . Resource team is verifying whether this is Restrict or Banned.
          </div>
      )}
      {isBusinessUser && account.status === 'IN_USE' && !account.disconnect_report && (
          <div className="mb-4 rounded-lg border border-ams-line bg-ams-panel px-4 py-3">
            {reportOpen ? (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-ams-ink">Report this account as disconnected/logged out</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input h-9 min-w-0 flex-1 py-0 text-[13px]"
                    placeholder="Optional note (e.g. when it logged out, what happened)…"
                    value={reportNote}
                    onChange={(e) => setReportNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm shrink-0"
                    disabled={reportDisconnect.isPending}
                    onClick={submitReport}
                  >
                    {reportDisconnect.isPending ? 'Sending…' : 'Submit report'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm shrink-0"
                    onClick={() => { setReportOpen(false); setReportNote(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-ams-muted">Got logged out? Report it here instead of the group.</p>
                <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => setReportOpen(true)}>
                  Report Disconnect
                </button>
              </div>
            )}
            {reportToast && <p className="mt-2 text-[12px] text-ams-muted">{reportToast}</p>}
          </div>
      )}

      {!isBusinessUser && account.disconnect_report && (
        <div className="mb-4 rounded-lg border border-ams-warn/50 bg-ams-warn/10 p-4">
          <p className="text-[13px] font-semibold text-ams-warn">
            ⚠ Pending confirmation
            {' — '}
            {account.disconnect_report.source === 'engine_health'
              ? 'keep-alive session dropped'
              : 'business reported a disconnect'}
            {' · '}
            {account.disconnect_report.reported_by}
            {' · '}
            {new Date(account.disconnect_report.logout_at || account.disconnect_report.reported_at).toLocaleString()}
            {' · '}
            {stageLabel(account.disconnect_report.stage)}
            {' · '}
            disconnect #{account.disconnect_report.disconnect_count || account.disconnect_count || 1}
          </p>
          {account.disconnect_report.note && (
            <p className="mt-1 text-[13px] text-ams-muted">“{account.disconnect_report.note}”</p>
          )}
          <p className="mt-1 text-[12px] text-ams-muted">
            Event time is the logout timestamp above — not the time you confirm.
            Check the phone, then mark Restrict, Banned, or false positive.
          </p>
          <div className="relative z-20 mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full max-w-[16.5rem] shrink-0">
              <select
                className="input h-10 w-full py-0 text-[13px] leading-normal"
                value={resolveOutcome}
                onChange={(e) => setResolveOutcome(e.target.value)}
                aria-label="Resolution outcome"
              >
                {RESOLVE_OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <input
              className="input h-10 min-w-0 flex-1 py-0 text-[13px] leading-normal"
              placeholder="Reason (required)…"
              value={resolveReason}
              onChange={(e) => setResolveReason(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm shrink-0 self-start sm:self-auto"
              disabled={resolveDisconnect.isPending}
              onClick={submitResolve}
            >
              {resolveDisconnect.isPending ? 'Saving…' : 'Confirm'}
            </button>
          </div>
          {resolveToast && <p className="mt-2 text-[12px] text-ams-muted">{resolveToast}</p>}
        </div>
      )}

      {!isBusinessUser && anomalyEvents.length > 0 && (
        <div className="card mb-4">
          <div className="border-b border-ams-line px-4 py-3 text-sm font-semibold">Anomaly events</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-ams-line text-[11px] uppercase tracking-wide text-ams-faint">
                  <th className="px-4 py-2 font-semibold">Logout time</th>
                  <th className="px-4 py-2 font-semibold">Stage</th>
                  <th className="px-4 py-2 font-semibold">Disconnect #</th>
                  <th className="px-4 py-2 font-semibold">Confirmation</th>
                </tr>
              </thead>
              <tbody>
                {anomalyEvents.map((ev, i) => (
                  <tr key={`${eventLogoutAt(ev) || i}-${ev.confirmation_status || ev.outcome || i}`} className="border-b border-ams-line last:border-b-0">
                    <td className="px-4 py-2 font-mono text-[12px]">
                      {eventLogoutAt(ev) ? new Date(eventLogoutAt(ev)).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2">{stageLabel(ev.stage)}</td>
                    <td className="px-4 py-2">{ev.disconnect_count || '—'}</td>
                    <td className="px-4 py-2">{anomalyStatusLabel(ev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[11px] text-ams-faint">
            Occurrence time is the keep-alive logout, not when Resource filled the form.
          </p>
        </div>
      )}

      {!isBusinessUser && account.status === 'IN_USE' && account.restrict_kind && (
        <div className="mb-4 min-w-0 rounded-lg border border-ams-accent/40 bg-ams-accent/10 p-4">
          <p className="text-[13px] font-semibold text-ams-ink">
            Restriction period — return to Standby when it ends
          </p>
          <p className="mt-1 text-[13px] text-ams-muted">
            {restriction.label}. After the restriction lifts, put this account back on Standby
            so the assigned staff can request it again from Delivery tickets.
          </p>
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            <input
              className="input h-9 w-full min-w-0 max-w-full text-[13px]"
              placeholder="Optional note (e.g. restriction ended)…"
              value={standbyReason}
              onChange={(e) => setStandbyReason(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm self-start"
              disabled={returnStandby.isPending}
              onClick={submitReturnStandby}
            >
              {returnStandby.isPending ? 'Saving…' : 'Return to Standby'}
            </button>
          </div>
          {standbyToast && <p className="mt-2 text-[12px] text-ams-muted">{standbyToast}</p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="border-b border-ams-line px-4 py-3 text-sm font-semibold">Account Info</div>
          <div className="space-y-0 p-4 text-[13.5px]">
            <div className="mb-3 rounded-lg border border-ams-line bg-ams-surface-muted/50 px-3.5 py-3">
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                <div className="min-w-0">
                  <div className="mb-1.5">
                    <div className="text-[12px] font-semibold text-ams-ink">Staff</div>
                    <div className="text-[10.5px] leading-snug text-ams-faint">
                      {isBrandSharedAccount(account) ? 'Brand-wide · no individual assignee' : 'Business assignee for Delivery'}
                    </div>
                  </div>
                  {canSetStaff && !isBrandSharedAccount(account) ? (
                    <div>
                      <div className="flex items-center gap-2">
                        <input
                          className="input h-9 min-w-0 flex-1 bg-white text-[13px] shadow-sm"
                          list="account-staff-suggestions"
                          value={staffDraft}
                          onChange={(e) => setStaffDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveStaff();
                            }
                          }}
                          placeholder="Type staff name…"
                          autoComplete="off"
                          aria-label="Staff name"
                        />
                        <datalist id="account-staff-suggestions">
                          {staffOptions.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm shrink-0"
                          disabled={patchAccount.isPending || staffDraft.trim() === (account.staff || '')}
                          onClick={saveStaff}
                        >
                          {patchAccount.isPending ? '…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-9 items-center rounded-lg border border-ams-line bg-white px-3 text-[13px] font-semibold text-ams-ink">
                      {staffDisplay(account)}
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="mb-1.5">
                    <div className="text-[12px] font-semibold text-ams-ink">Access type</div>
                    <div className="text-[10.5px] leading-snug text-ams-faint">
                      Personal = one staff · Shared = whole Brand
                    </div>
                  </div>
                  {canSetStaff ? (
                    <div className="[&>div]:flex [&>div]:w-full [&>div>button]:min-w-0 [&>div>button]:flex-1">
                      <SegControl
                        size="sm"
                        value={typeDraft}
                        onChange={(v) => {
                          if (!patchAccount.isPending) saveAccountType(v);
                        }}
                        options={[
                          { value: ACCOUNT_TYPE_PERSONAL, label: 'Personal' },
                          { value: ACCOUNT_TYPE_BRAND_SHARED, label: 'Shared' },
                        ]}
                      />
                    </div>
                  ) : (
                    <div className="flex h-9 items-center rounded-lg border border-ams-line bg-white px-3 text-[13px] font-semibold text-ams-ink">
                      {accountTypeLabel(account.account_type)}
                    </div>
                  )}
                </div>
              </div>
              {staffToast ? (
                <p className="mt-2 text-right text-[11px] text-ams-muted">{staffToast}</p>
              ) : null}
            </div>
            {infoRows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-ams-line py-2.5 last:border-0">
                <span className="shrink-0 text-ams-faint">{k}</span>
                <span className={`text-right font-semibold ${k.includes('IP') ? 'font-mono text-[12px]' : ''}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between gap-3 border-b border-ams-line px-4 py-3">
            <span className="text-sm font-semibold">Status History</span>
            {(account.statusHistory || []).length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                onClick={() => setHistoryOpen(true)}
              >
                Full history
              </button>
            )}
          </div>
          <div className="p-4">
            <NurtureTimeline
              account={account}
              history={account.statusHistory || []}
              tickets={account.deliveryTickets || []}
              compact
            />
            {(account.statusHistory || []).length === 0 ? (
              <p className="text-[13px] text-ams-muted">No status changes recorded yet.</p>
            ) : (
              <>
                <ul className="space-y-3">
                  {(account.statusHistory || []).slice(0, 4).map((h) => (
                    <HistoryEventItem key={h.id} event={h} />
                  ))}
                </ul>
                {(account.statusHistory || []).length > 4 && (
                  <p className="mt-3 text-[12px] text-ams-faint">
                    {(account.statusHistory || []).length - 4} older events — open Full history
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {isBrandSharedAccount(account) && (
        <div className="card mt-4 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-ams-line px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ams-ink">Usage history</div>
              <p className="mt-0.5 text-[12px] text-ams-faint">
                Who held this Brand-shared account — append-only
              </p>
            </div>
            {usageEvents.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                onClick={() => setUsageOpen(true)}
              >
                Full history
              </button>
            )}
          </div>
          <div className="p-4">
            {usageLoading ? (
              <p className="text-[13px] text-ams-muted">Loading usage…</p>
            ) : usageEvents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ams-line bg-ams-surface-muted/40 px-4 py-5 text-center text-[13px] text-ams-muted">
                No usage events yet. Requests, confirms, and disconnect reports will appear here.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-ams-line">
                <UsageHistoryTable events={usageEvents} compact />
              </div>
            )}
          </div>
        </div>
      )}

      <DetailDialog
        open={historyOpen}
        title={`Status history · ${account.account_name}`}
        onClose={() => setHistoryOpen(false)}
      >
        <NurtureTimeline
          account={account}
          history={account.statusHistory || []}
          tickets={account.deliveryTickets || []}
        />
        {(account.statusHistory || []).length === 0 ? (
          <p className="text-[13px] text-ams-muted">No status changes recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {(account.statusHistory || []).map((h) => (
              <HistoryEventItem key={h.id} event={h} />
            ))}
          </ul>
        )}
      </DetailDialog>

      <DetailDialog
        open={usageOpen}
        title={`Usage history · ${account.account_name}`}
        onClose={() => setUsageOpen(false)}
      >
        {usageEvents.length === 0 ? (
          <p className="text-[13px] text-ams-muted">No usage events recorded yet.</p>
        ) : (
          <UsageHistoryTable events={usageEvents} />
        )}
      </DetailDialog>

      <Drawer
        open={standbyDrawer === 'banned'}
        title="Mark Banned"
        onClose={() => setStandbyDrawer(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setStandbyDrawer(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={standbyUpdateBusy || banAccount.isPending}
              onClick={submitStandbyPhoneUpdate}
            >
              {standbyUpdateBusy ? 'Saving…' : 'Confirm Ban'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-ams-muted">
            Removes this account from Frontline Standby requests and sends it to Recovery.
          </p>
          <div className="rounded-lg border border-ams-line bg-ams-surface-muted px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ams-faint">Account</div>
            <div className="text-sm font-semibold text-ams-ink">{account.account_name}</div>
          </div>
          <label className="drawer-field">
            <span className="drawer-label">Ban reason</span>
            <select
              className="input h-10 min-h-10 w-full py-0 text-[13px] leading-normal"
              value={standbyBanReason}
              onChange={(e) => setStandbyBanReason(e.target.value)}
            >
              {STANDBY_BAN_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
      </Drawer>

      <Drawer
        open={standbyDrawer === 'restrict'}
        title="Mark Restrict"
        onClose={() => setStandbyDrawer(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setStandbyDrawer(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={standbyUpdateBusy || markStrict.isPending || !standbyOutcome}
              onClick={submitStandbyPhoneUpdate}
            >
              {standbyUpdateBusy ? 'Saving…' : 'Confirm Restrict'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-ams-muted">
            Choose the restriction shown on the phone. Account stays Standby but is hidden from
            Frontline Delivery until cleared.
          </p>
          <div className="rounded-lg border border-ams-line bg-ams-surface-muted px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ams-faint">Account</div>
            <div className="text-sm font-semibold text-ams-ink">{account.account_name}</div>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[12px] font-semibold text-ams-ink">Restriction type</legend>
            {STANDBY_RESTRICT_KINDS.map((opt) => {
              const selected = standbyOutcome === opt.id;
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
                    name="standby-restrict"
                    value={opt.id}
                    checked={selected}
                    disabled={standbyUpdateBusy}
                    onChange={() => setStandbyOutcome(opt.id)}
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
      </Drawer>

      <ConfirmDialog
        open={unlinkSimOpen}
        title="Unlink SIM from account?"
        message={
          account.sim
            ? `Remove the binding to ${account.sim}? The SIM stays in the ledger; only this account link is cleared.`
            : 'Remove the SIM binding from this account? The SIM stays in the ledger; only this account link is cleared.'
        }
        confirmLabel={unlinkSimBusy ? 'Unlinking…' : 'Unlink'}
        onConfirm={confirmUnlinkSim}
        onCancel={() => !unlinkSimBusy && setUnlinkSimOpen(false)}
      />

      <Toast open={!!standbyUpdateToast} message={standbyUpdateToast} onClose={() => setStandbyUpdateToast('')} />
      <Toast open={!!unlinkSimToast} message={unlinkSimToast} onClose={() => setUnlinkSimToast('')} />
    </div>
  );
}

export default function AccountsPage() {
  const { site } = useSite();
  const { profile } = useAuth();
  const isBusiness = profile?.role === 'business';
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fStaff, setFStaff] = useState('');
  const [fSt, setFSt] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [page, setPage] = useState(1);

  const { data: accounts = [], isLoading: accountsLoading, isError: accountsError } = useAllAccounts();
  const staffScope = useMemo(() => profileStaffScope(profile), [profile]);
  const visibleAccounts = useMemo(
    () => accounts.filter((a) => accountInStaffScope(a, staffScope)),
    [accounts, staffScope],
  );

  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId) return;
    setDetailId(openId);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const staffOptions = useMemo(() => {
    const names = new Set();
    visibleAccounts.forEach((a) => {
      if (isBrandSharedAccount(a)) return;
      const s = String(a.staff || '').trim();
      if (s) names.add(s);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [visibleAccounts]);

  const staffFilterOptions = useMemo(() => {
    const list = [STAFF_FILTER_UNASSIGNED, ...staffOptions];
    if (visibleAccounts.some((a) => isBrandSharedAccount(a))) {
      list.splice(1, 0, STAFF_FILTER_SHARED);
    }
    return list;
  }, [staffOptions, visibleAccounts]);

  const staffAssignmentSummary = useMemo(() => {
    const counts = new Map();
    let total = 0;
    visibleAccounts.forEach((a) => {
      if (!accountInLedgerSite(a, site)) return;
      if (fBrand && resolveAccountBrand(a) !== fBrand) return;
      if (!matchesLedgerStatusFilter(a, fSt)) return;
      const staffKey = staffAssignmentKey(a);
      const brand = ledgerBrandLabel(a);
      const key = `${staffKey}\t${brand}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      total += 1;
    });

    const rank = (staffKey) => {
      if (staffKey === STAFF_FILTER_UNASSIGNED) return 2;
      if (staffKey === STAFF_FILTER_SHARED) return 1;
      return 0;
    };

    const rows = [...counts.entries()].map(([key, count]) => {
      const [staffKey, brand] = key.split('\t');
      return {
        staffKey,
        brand,
        label: staffAssignmentLabel(staffKey),
        count,
      };
    }).sort((a, b) => {
      const missing = Number(isMissingBrand(a.brand)) - Number(isMissingBrand(b.brand));
      if (missing !== 0) return missing;
      const byType = rank(a.staffKey) - rank(b.staffKey);
      if (byType !== 0) return byType;
      const byStaff = a.label.localeCompare(b.label);
      if (byStaff !== 0) return byStaff;
      return a.brand.localeCompare(b.brand);
    });

    if (!rows.some((row) => row.staffKey === STAFF_FILTER_UNASSIGNED)) {
      rows.push({
        staffKey: STAFF_FILTER_UNASSIGNED,
        brand: MISSING_BRAND,
        label: 'Unassigned',
        count: 0,
      });
    }

    return { rows, total };
  }, [visibleAccounts, site, fBrand, fSt]);

  const pendingDisconnects = useMemo(() => {
    if (isBusiness) return [];
    return accounts
      .filter((a) => a.disconnect_report)
      .filter((a) => site === 'all' || a.siteKey === site || a.siteKey === 'all')
      .sort((a, b) => {
        const ta = new Date(a.disconnect_report?.reported_at || 0).getTime();
        const tb = new Date(b.disconnect_report?.reported_at || 0).getTime();
        return tb - ta;
      });
  }, [accounts, isBusiness, site]);

  // Business can't read /devices (ops-only asset ledger) — skip the device-card grouping
  // and show a flat, brand-scoped account list instead.
  const { data: devices = [], isLoading: devicesLoading, isError: devicesError } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await api.get('/devices', { params: { limit: 500 } });
      return res.data?.data || [];
    },
    enabled: !isBusiness,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const ledgerDevices = useMemo(() => {
    const byId = new Map();
    devices.forEach((d) => {
      if (d?.id) byId.set(d.id, d);
    });
    accounts.forEach((a) => {
      if (!a.device_id || byId.has(a.device_id)) return;
      byId.set(a.device_id, {
        id: a.device_id,
        device_name: a.device || a.device_id,
      });
    });
    return [...byId.values()];
  }, [devices, accounts]);

  const businessRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleAccounts
      .filter((a) => {
        if (site !== 'all' && a.siteKey !== site && a.siteKey !== 'all') return false;
        if (fBrand && resolveAccountBrand(a) !== fBrand) return false;
        if (!matchesLedgerStatusFilter(a, fSt)) return false;
        if (q) {
          const hay = `${a.account_name} ${a.phone_number} ${a.staff} ${staffDisplay(a)}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => String(a.account_name || '').localeCompare(String(b.account_name || '')));
  }, [visibleAccounts, search, site, fBrand, fSt]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let devCount = 0;
    let acctCount = 0;
    const cards = [];

    const sortedDevices = filterDevicesBySite([...ledgerDevices].sort(compareDeviceNames), site);

    const hasActiveFilter = Boolean(q || fBrand || fStaff || fSt);

    sortedDevices.forEach((device) => {
      const name = String(device.device_name || '').toUpperCase();
      // Prefer devices.site_key so location can differ from MYR/PP name prefix.
      const siteKey = (device.site_key === 'pp' || device.site_key === 'my')
        ? device.site_key
        : name.startsWith('PP')
          ? 'pp'
          : name.startsWith('SGD')
            ? (site === 'pp' || site === 'my' ? site : 'all')
            : 'my';

      const deviceAccounts = accounts
        .filter((a) => a.device_id === device.id)
        .sort((a, b) => {
          const d = channelSlotIndex(a.channel) - channelSlotIndex(b.channel);
          if (d !== 0) return d;
          return String(a.account_name || '').localeCompare(String(b.account_name || ''));
        });

      const devHit = q && device.device_name.toLowerCase().includes(q);

      function acctMatch(a) {
        if (fBrand && resolveAccountBrand(a) !== fBrand) return false;
        if (!accountMatchesStaffFilter(a, fStaff)) return false;
        if (!matchesLedgerStatusFilter(a, fSt)) return false;
        if (q && !devHit) {
          const hay = `${a.account_name} ${a.phone_number} ${a.staff} ${staffDisplay(a)} ${device.device_name}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }

      const matched = deviceAccounts.filter(acctMatch);

      if (hasActiveFilter && !devHit && matched.length === 0) return;

      devCount += 1;
      acctCount += matched.length;

      cards.push({ device, siteKey, accounts: matched, allAccounts: deviceAccounts });
    });

    const orphanAccounts = accounts.filter((a) => {
      if (a.device_id) return false;
      if (site !== 'all' && a.siteKey !== site) return false;
      if (fBrand && resolveAccountBrand(a) !== fBrand) return false;
      if (!accountMatchesStaffFilter(a, fStaff)) return false;
      if (!matchesLedgerStatusFilter(a, fSt)) return false;
      if (q) {
        const hay = `${a.account_name} ${a.phone_number} ${a.staff} ${staffDisplay(a)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (orphanAccounts.length) {
      acctCount += orphanAccounts.length;
    }

    const orphanCard = orphanAccounts.length
      ? {
          device: { id: 'orphan', device_name: 'Unassigned', notes: '' },
          siteKey: site,
          accounts: orphanAccounts,
          unassigned: true,
        }
      : null;

    return { deviceCards: cards, orphanCard, devCount, acctCount };
  }, [accounts, ledgerDevices, search, site, fBrand, fStaff, fSt]);

  const pageSize = isBusiness ? BUSINESS_PAGE_SIZE : LEDGER_PAGE_SIZE;
  const totalItems = isBusiness ? businessRows.length : filtered.deviceCards.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageCards = filtered.deviceCards.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const pageRows = businessRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const pageStart = totalItems ? (safePage - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(safePage * pageSize, totalItems);

  useEffect(() => {
    setPage(1);
  }, [search, fBrand, fStaff, fSt, site]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (detailId) {
    return (
      <AccountDetail
        accountId={detailId}
        onBack={() => setDetailId(null)}
        staffOptions={staffOptions}
      />
    );
  }

  // Business only ever sees post-delivery statuses — Registering/Nurturing/Standby are
  // internal pool states that never reach them, so hide those filter options entirely.
  const statusFilters = isBusiness
    ? [
        ['', 'All statuses'],
        ['inuse', 'In Use'],
        ['restricted', 'Restricted'],
        ['standby', 'Standby'],
        ['loggedout', 'Logged out'],
        ['recovering', 'Recovering'],
        ['banned', 'Banned'],
      ]
    : [
        ['', 'All statuses'],
        ['registering', 'Registering'],
        ['nurturing', 'Nurturing'],
        ['standby', 'Standby'],
        ['inuse', 'In Use'],
        ['restricted', 'Restricted'],
        ['loggedout', 'Logged out'],
        ['recovering', 'Recovering'],
        ['banned', 'Banned'],
      ];

  function renderDevCard({ device, siteKey, accounts: deviceAccts, allAccounts: deviceAllAccts, unassigned = false }) {
    const displayAccounts = deviceAccts;
    const { slots, overflow } = groupAccountsByDeviceSlots(displayAccounts);
    const allGrouped = unassigned ? null : groupAccountsByDeviceSlots(deviceAllAccts || displayAccounts);
    const occupied = allGrouped
      ? allGrouped.slots.filter((s) => s.account).length
      : displayAccounts.length;
    const extraCount = allGrouped?.overflow.length || 0;

    return (
      <div key={device.id} className="rl-dev-card">
        <div className="rl-dev-head">
          <span className="font-mono text-sm font-bold text-ams-ink">{device.device_name}</span>
          {device.id !== 'orphan' && (
            <div className="rl-dev-meta">
              <span className="text-[11px] font-medium text-ams-faint">
                {occupied}/{DEVICE_MAX_SLOTS} slots
                {extraCount > 0 && (
                  <span className="ml-1 text-ams-warn">· {extraCount} extra</span>
                )}
              </span>
              <span className={getSiteChipClass(siteKey)}>{siteChipLabel(siteKey)}</span>
            </div>
          )}
        </div>
        {unassigned ? (
          displayAccounts.map((a) => (
            <AcctRow
              key={a.id}
              account={a}
              onOpen={(row) => setDetailId(row.id)}
              showSiteBubble={site === 'all'}
            />
          ))
        ) : (
          <>
            {slots.map(({ slotLabel, account }) => (
              account ? (
                <AcctRow
                  key={account.id}
                  account={account}
                  slotLabel={slotLabel}
                  onOpen={(row) => setDetailId(row.id)}
                />
              ) : (
                <EmptySlotRow key={slotLabel} slotLabel={slotLabel} />
              )
            ))}
            {overflow.map((a) => (
              <AcctRow
                key={a.id}
                account={a}
                extra
                onOpen={(row) => setDetailId(row.id)}
              />
            ))}
          </>
        )}
      </div>
    );
  }

  const hasResults = isBusiness
    ? businessRows.length > 0
    : filtered.deviceCards.length > 0 || filtered.orphanCard;

  const isLoading = isBusiness
    ? accountsLoading
    : (accountsLoading || devicesLoading);

  const loadFailed = !isLoading && (accountsError || (!isBusiness && devicesError && ledgerDevices.length === 0));

  return (
    <div>
      <PageHead
        title={isBusiness ? 'Check Account Status' : 'Resource Ledger'}
        description={isBusiness
          ? 'Your delivered accounts only — check status (In Use, Logged out, Restricted, Banned, Recovering) without asking R&M in the group.'
          : 'Lookup by device, account, phone, brand, or Staff. After a Restricted review, return the account to Standby when the period ends so business can request it again.'}
      />

      {!isBusiness && pendingDisconnects.length > 0 && (
        <div className="mb-4 rounded-lg border border-ams-warn/40 bg-ams-warn/10 px-4 py-3">
          <p className="text-[13px] font-semibold text-ams-warn">
            {pendingDisconnects.length} pending confirmation{pendingDisconnects.length === 1 ? '' : 's'} — action needed
          </p>
          <ul className="mt-2 space-y-2">
            {pendingDisconnects.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px]">
                    <span className="font-semibold text-ams-ink">{a.account_name}</span>
                    <span className="text-ams-muted">
                      {' · '}
                      {a.staff || isBrandSharedAccount(a)
                        ? `Staff · ${staffDisplay(a)}`
                        : (a.disconnect_report.reported_by || 'Business')}
                      {' · '}
                      {new Date(a.disconnect_report.reported_at).toLocaleString()}
                    </span>
                  </p>
                  {a.disconnect_report.note ? (
                    <p className="mt-0.5 text-[12px] text-ams-faint">
                      “{a.disconnect_report.note}”
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm shrink-0"
                  onClick={() => setDetailId(a.id)}
                >
                  Review
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="page-filter-bar">
        <div className="page-filter-search">
          <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
          <input
            className="input"
            placeholder={isBusiness ? 'Search account or phone…' : 'Search device ID, account, staff, or phone…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={fBrand}
            onChange={(e) => setFBrand(e.target.value)}
            aria-label="Filter by brand"
          >
            <option value="">All brands</option>
            {BRAND_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        {!isBusiness && (
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={fStaff}
            onChange={(e) => setFStaff(e.target.value)}
            aria-label="Filter by staff"
          >
            <option value="">All staff</option>
            {staffFilterOptions.map((o) => (
              <option key={o} value={o}>{staffAssignmentLabel(o)}</option>
            ))}
          </select>
        </label>
        )}
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={fSt}
            onChange={(e) => setFSt(e.target.value)}
            aria-label="Filter by status"
          >
            {statusFilters.map(([v, l]) => (
              <option key={v || 'all'} value={v}>{l}</option>
            ))}
          </select>
        </label>
      </div>

      {!isBusiness && !isLoading && !loadFailed && (
        <StaffAssignmentSummary
          rows={staffAssignmentSummary.rows}
          total={staffAssignmentSummary.total}
          selectedStaff={fStaff}
          selectedBrand={fBrand}
          onSelect={(row) => {
            const brandValue = isMissingBrand(row.brand) ? '' : row.brand;
            const same = fStaff === row.staffKey && fBrand === brandValue;
            if (same) {
              setFStaff('');
              setFBrand('');
              return;
            }
            setFStaff(row.staffKey);
            setFBrand(brandValue);
          }}
        />
      )}

      {isLoading ? (
        <p className="py-10 text-center text-sm text-ams-faint">Loading ledger…</p>
      ) : loadFailed ? (
        <p className="py-10 text-center text-sm text-ams-warn">
          Couldn’t load the ledger. Refresh the page.
        </p>
      ) : !hasResults ? (
        <p className="py-10 text-center text-sm text-ams-faint">
          {isBusiness ? 'No accounts match the filters.' : 'No devices or accounts match the filters.'}
        </p>
      ) : isBusiness ? (
        <>
          <div className="rl-head-row mb-1 hidden lg:grid">
            <span>Account</span><span>Status</span><span>Phone</span><span>IP</span><span>Brand</span><span className="rl-col-staff-head">Staff</span>
          </div>

          <div className="rl-dev-card">
            {pageRows.map((a) => (
              <AcctRow
                key={a.id}
                account={a}
                onOpen={(row) => setDetailId(row.id)}
                showSiteBubble={site === 'all'}
              />
            ))}
          </div>

          {businessRows.length > BUSINESS_PAGE_SIZE && (
            <div className="tk-pager">
              <p className="tk-pager-meta">
                Showing {pageStart}–{pageEnd} of {businessRows.length} accounts
              </p>
              <div className="tk-pager-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  Previous
                </button>
                <span className="tk-pager-page">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rl-head-row mb-1 hidden lg:grid">
            <span>Account</span><span>Status</span><span>Phone</span><span>IP</span><span>Brand</span><span className="rl-col-staff-head">Staff</span>
          </div>

          {pageCards.map(renderDevCard)}

          {filtered.deviceCards.length > LEDGER_PAGE_SIZE && (
            <div className="tk-pager">
              <p className="tk-pager-meta">
                Showing {pageStart}–{pageEnd} of {filtered.deviceCards.length} devices
              </p>
              <div className="tk-pager-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  Previous
                </button>
                <span className="tk-pager-page">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {filtered.orphanCard && (
            <div className="rl-unassigned mt-6">
              {renderDevCard(filtered.orphanCard)}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-center text-[13px] text-ams-muted">
        {isBusiness
          ? `${SITES[site].name} · ${businessRows.length} accounts`
          : `${SITES[site].name} · ${filtered.devCount} devices · ${filtered.acctCount} accounts`}
      </p>
    </div>
  );
}
