import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Toast from './Toast';
import { useSite } from '../context/SiteContext';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { useAccountMutations, useAllAccounts } from '../hooks/useOperatorAccounts';
import { matchAccountForEngineSlot } from '../lib/engine-slot';
import { CURRENT_STATUS } from '../lib/feeding-audit';
import { SITES, getSiteChipClass } from '../lib/sites';

const STATUS_OPTIONS = [
  { kind: 'active', label: CURRENT_STATUS.ACTIVE, short: 'Active' },
  { kind: 'restrict_scan', label: CURRENT_STATUS.RESTRICTED_SCAN, short: 'Restrict Scan' },
  { kind: 'restrict_chat_new', label: CURRENT_STATUS.RESTRICTED_CHAT_NEW, short: 'Restrict Chat New' },
];

const STATUS_BADGE = {
  active: 'badge-success',
  restrict_scan: 'badge-warn',
  restrict_chat_new: 'badge-warn',
  banned: 'badge-danger',
};

const LIVE_BADGE = {
  Feeding: 'badge-success',
  Online: 'badge-success',
  Linking: 'badge-warn',
  Offline: 'badge-default',
};

function kindFromAccount(account) {
  if (account?.status === 'BANNED') return 'banned';
  if (account?.restrict_kind === 'restrict_scan') return 'restrict_scan';
  if (account?.restrict_kind === 'restrict_chat_new') return 'restrict_chat_new';
  return 'active';
}

function slotLiveLabel(slot) {
  if (!slot) return 'Offline';
  if (slot.feedingActive) return 'Feeding';
  if (slot.linking) return 'Linking';
  if (slot.connected || slot.authSaved) return 'Online';
  return 'Offline';
}

/**
 * Real-time FeedFlow fleet statuses — R&M can change Current Status here
 * (Active / Restricted Scan / Restricted Chat New Contact).
 */
export default function FeedFlowAccountStatusPanel() {
  const { site } = useSite();
  const { data: engineData, isLoading: engineLoading, isFetching, refetch } = useEngineStatus();
  const { data: accounts = [], isLoading: accountsLoading } = useAllAccounts();
  const { markStrict } = useAccountMutations();
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const slots = engineData?.slots || engineData?.accounts || [];
  const reachable = engineData?.reachable === true;

  const rows = useMemo(() => {
    const scoped = site === 'all'
      ? accounts
      : accounts.filter((a) => a.siteKey === site);

    return (slots || []).map((slot) => {
      const account = matchAccountForEngineSlot(scoped, slot)
        || matchAccountForEngineSlot(accounts, slot);
      const label = slot.label
        || account?.account_name
        || `Account ${Number(slot.slot) + 1}`;
      return {
        slot,
        account,
        label,
        phone: slot.phone || account?.phone_number || '',
        kind: kindFromAccount(account),
        siteKey: account?.siteKey || null,
      };
    }).filter((row) => {
      if (site === 'all') return true;
      // Keep unmapped engine slots visible on All only; when filtered, prefer matched site.
      if (!row.account) return false;
      return row.account.siteKey === site;
    });
  }, [slots, accounts, site]);

  const counts = useMemo(() => {
    const c = { active: 0, restrict_scan: 0, restrict_chat_new: 0, unmatched: 0 };
    for (const r of rows) {
      if (!r.account) c.unmatched += 1;
      else c[r.kind] = (c[r.kind] || 0) + 1;
    }
    return c;
  }, [rows]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3800);
  };

  async function changeStatus(row, nextKind) {
    if (!row.account || busyId || nextKind === row.kind) return;
    setBusyId(row.account.id);
    try {
      await markStrict.mutateAsync({ id: row.account.id, kind: nextKind });
      const label = STATUS_OPTIONS.find((o) => o.kind === nextKind)?.label || nextKind;
      showToast(`${row.label} · Current Status → ${label}`);
      refetch();
    } catch (e) {
      showToast(e?.response?.data?.error || e.message || 'Failed to update status');
    } finally {
      setBusyId(null);
    }
  }

  const loading = engineLoading || accountsLoading;

  return (
    <section className="card mb-6 overflow-hidden">
      <div className="engine-panel-head border-b border-ams-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ams-ink">Current Status (FeedFlow accounts)</h2>
          <p className="text-[11px] text-ams-faint">
            Real-time fleet tracking — change status here when an account becomes Restricted Scan
            or Restricted Chat New Contact (writes AMS Audit + Feeding Log).
          </p>
        </div>
        <div className="engine-panel-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh engine"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-ams-line px-5 py-3 text-[12px]">
        <span className="rounded-full bg-ams-surface-muted px-2.5 py-1 text-ams-muted">
          Active <strong className="text-ams-ink">{counts.active}</strong>
        </span>
        <span className="rounded-full bg-ams-warn/10 px-2.5 py-1 text-ams-warn">
          Restricted Scan <strong>{counts.restrict_scan}</strong>
        </span>
        <span className="rounded-full bg-ams-warn/10 px-2.5 py-1 text-ams-warn">
          Chat New Contact <strong>{counts.restrict_chat_new}</strong>
        </span>
        {!reachable && (
          <span className="rounded-full bg-ams-danger/10 px-2.5 py-1 text-ams-danger">
            Engine offline
          </span>
        )}
      </div>

      {loading ? (
        <p className="p-8 text-center text-sm text-ams-faint">Loading FeedFlow accounts…</p>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-ams-faint">
          No FeedFlow slots for this site. Link accounts in Nurturing scan-in first.
        </p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Account</th>
                <th>Phone</th>
                <th className="col-center">Live</th>
                {site === 'all' && <th className="col-center">Site</th>}
                <th className="col-center">Current Status</th>
                <th className="col-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busy = busyId === row.account?.id;
                const statusOpt = STATUS_OPTIONS.find((o) => o.kind === row.kind);
                const statusLabel = row.kind === 'banned'
                  ? 'Banned'
                  : (statusOpt?.label || 'Active');
                const actionLabel = statusOpt?.short || 'Active';
                const liveLabel = slotLiveLabel(row.slot);
                return (
                  <tr key={`slot-${row.slot.slot}`}>
                    <td className="col-mono col-muted">{Number(row.slot.slot) + 1}</td>
                    <td className="font-medium text-ams-ink">{row.label}</td>
                    <td className="col-mono text-[12px]">{row.phone || '—'}</td>
                    <td className="col-center">
                      <span className={`badge ${LIVE_BADGE[liveLabel] || 'badge-default'}`}>
                        {liveLabel}
                      </span>
                    </td>
                    {site === 'all' && (
                      <td className="col-center">
                        {row.siteKey
                          ? <span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span>
                          : '—'}
                      </td>
                    )}
                    <td className="col-center">
                      {row.account ? (
                        <span className={`badge ${STATUS_BADGE[row.kind] || 'badge-default'}`}>
                          {statusLabel}
                        </span>
                      ) : (
                        <span className="text-[12px] text-ams-faint">—</span>
                      )}
                    </td>
                    <td className="col-center whitespace-nowrap">
                      {row.account && row.kind !== 'banned' ? (
                        <div className="inline-flex items-center justify-center gap-2">
                          <select
                            className="input shrink-0 py-1 text-[12px]"
                            style={{
                              width: `calc(${actionLabel.length}ch + 2.25rem)`,
                              fieldSizing: 'content',
                            }}
                            value={row.kind}
                            disabled={busy || !!busyId}
                            aria-label={`Change current status for ${row.label}`}
                            onChange={(e) => changeStatus(row, e.target.value)}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.kind} value={opt.kind}>{opt.short}</option>
                            ))}
                          </select>
                          {busy && <span className="text-[11px] text-ams-faint">Saving…</span>}
                        </div>
                      ) : row.account ? (
                        <span className="text-[12px] text-ams-faint">See Recovery</span>
                      ) : (
                        <span className="text-[12px] text-ams-faint">No AMS account linked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Toast open={!!toast} message={toast} onClose={() => setToast('')} />
    </section>
  );
}
