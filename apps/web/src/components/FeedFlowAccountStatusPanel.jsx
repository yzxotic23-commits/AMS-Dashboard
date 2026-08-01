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
  { kind: 'active', label: CURRENT_STATUS.ACTIVE },
  { kind: 'restrict_scan', label: CURRENT_STATUS.RESTRICTED_SCAN },
  { kind: 'restrict_chat_new', label: CURRENT_STATUS.RESTRICTED_CHAT_NEW },
];

function kindFromAccount(account) {
  if (account?.restrict_kind === 'restrict_scan') return 'restrict_scan';
  if (account?.restrict_kind === 'restrict_chat_new') return 'restrict_chat_new';
  return 'active';
}

function slotLiveLabel(slot) {
  if (!slot) return '—';
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
                <th>Live</th>
                {site === 'all' && <th>Site</th>}
                <th>Current Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busy = busyId === row.account?.id;
                return (
                  <tr key={`slot-${row.slot.slot}`}>
                    <td className="col-mono col-muted">{Number(row.slot.slot) + 1}</td>
                    <td className="font-medium text-ams-ink">{row.label}</td>
                    <td className="col-mono text-[12px]">{row.phone || '—'}</td>
                    <td>
                      <span className="badge badge-default">{slotLiveLabel(row.slot)}</span>
                    </td>
                    {site === 'all' && (
                      <td className="col-center">
                        {row.siteKey
                          ? <span className={getSiteChipClass(row.siteKey)}>{SITES[row.siteKey].name}</span>
                          : '—'}
                      </td>
                    )}
                    <td>
                      {row.account ? (
                        <div className="flex items-center gap-2">
                          <select
                            className={`input py-1.5 text-[12px] font-medium ${
                              row.kind === 'active'
                                ? 'border-ams-accent/40 text-ams-ink'
                                : 'border-ams-warn/50 text-ams-warn'
                            }`}
                            style={{ minWidth: '13.5rem' }}
                            value={row.kind}
                            disabled={busy || !!busyId}
                            aria-label={`Change current status for ${row.label}`}
                            onChange={(e) => changeStatus(row, e.target.value)}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.kind} value={opt.kind}>{opt.label}</option>
                            ))}
                          </select>
                          {busy && <span className="text-[11px] text-ams-faint">Saving…</span>}
                        </div>
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
