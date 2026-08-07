import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useAllAccounts, useAccountDetail, useAccountMutations } from '../hooks/useOperatorAccounts';
import { statusMeta, resolveAccountBrand, BRAND_OPTIONS } from '../lib/account-status-labels';
import {
  compareDeviceNames,
  displayDeviceChannel,
  channelSlotIndex,
  groupAccountsByDeviceSlots,
  DEVICE_MAX_SLOTS,
} from '../lib/device-location';
import { nurturingDay, nurturingProgress } from '../lib/nurturing-day';
import { getBridgeSummary } from '../lib/bridge-client';
import { liveSlotConnection } from '../lib/engine-slot';
import api from '../lib/api';

const LEDGER_PAGE_SIZE = 5;

function siteChipLabel(siteKey) {
  if (siteKey === 'all') return 'All';
  return SITES[siteKey]?.name || siteKey;
}

function StatusPill({ status }) {
  const meta = statusMeta(status);
  return <span className={`badge ${meta.pill}`}>{meta.label}</span>;
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

  const siteTag = showSiteBubble && account.siteKey && account.siteKey !== 'all'
    ? account.siteKey
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
        <StatusPill status={account.status} />
        {day != null && (
          <span className="ml-1 font-mono text-[11px] text-ams-faint">
            ({day}/{account.nurturing_phase === 'manual' ? 3 : 7})
          </span>
        )}
      </div>
      <div className="font-mono text-[12px]">{account.phone_number || '—'}</div>
      <div className="font-mono text-[12px]">{account.ip || '—'}</div>
      <div className="text-[12.5px] text-ams-muted">{resolveAccountBrand(account) || '—'}</div>
      <div className="rl-col-staff">{account.staff || '—'}</div>
    </div>
  );
}

function AccountDetail({ accountId, onBack, staffOptions = [] }) {
  const { profile } = useAuth();
  const { data: account, isLoading } = useAccountDetail(accountId);
  const { patchAccount } = useAccountMutations();
  const canSetStaff = profile?.role === 'admin' || profile?.role === 'operator';
  const [staffDraft, setStaffDraft] = useState('');
  const [staffToast, setStaffToast] = useState('');

  useEffect(() => {
    setStaffDraft(account?.staff || '');
  }, [account?.id, account?.staff]);

  const { data: bridge } = useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: getBridgeSummary,
    staleTime: 20_000,
  });

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

  const infoRows = [
    ['Account', account.account_name],
    ['Phone', account.phone_number || '—'],
    ['Channel', displayDeviceChannel(account.channel) || '—'],
    ['Status', statusMeta(account.status).label],
    ['Brand', resolveAccountBrand(account) || '—'],
    ['Owner (registered by)', account.owner || '—'],
    ['Device', account.device || '—'],
    ['Site', SITES[account.siteKey]?.name || account.siteKey],
    ['Reference IP', account.reference_ip_address || account.ip || '—'],
    ['Current IP', account.ip || '—'],
    ['SIM', account.sim || '—'],
  ];
  if (nurture) infoRows.push(['Nurturing', `Day ${nurture.day}/${nurture.max} · ${nurture.remaining} left`]);
  if (engineStatus) infoRows.push(['Engine status', engineStatus]);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>‹ Back</button>
        <h1 className="text-[22px] font-bold">{account.account_name}</h1>
        <StatusPill status={account.status} />
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

      {canSetStaff && (
        <div className="card mb-4 p-4">
          <div className="mb-2 text-sm font-semibold">Staff (Business assignee)</div>
          <p className="mb-3 text-[12px] text-ams-muted">
            Name of the business staff this account belongs to. Separate from Owner (who registered it).
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1">
              <span className="drawer-label">Staff name</span>
              <input
                className="input"
                list="account-staff-suggestions"
                value={staffDraft}
                onChange={(e) => setStaffDraft(e.target.value)}
                placeholder="e.g. Abby"
                autoComplete="off"
              />
              <datalist id="account-staff-suggestions">
                {staffOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={patchAccount.isPending || staffDraft.trim() === (account.staff || '')}
              onClick={saveStaff}
            >
              {patchAccount.isPending ? 'Saving…' : 'Save staff'}
            </button>
          </div>
          {staffToast && (
            <p className="mt-2 text-[12px] text-ams-muted">{staffToast}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="border-b border-ams-line px-4 py-3 text-sm font-semibold">Account Info</div>
          <div className="space-y-0 p-4 text-[13.5px]">
            <div className="flex justify-between gap-4 border-b border-ams-line py-2.5">
              <span className="shrink-0 text-ams-faint">Staff</span>
              <span className="text-right font-semibold">{account.staff || '—'}</span>
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
          <div className="border-b border-ams-line px-4 py-3 text-sm font-semibold">Status History</div>
          <div className="p-4">
            {(account.statusHistory || []).length === 0 ? (
              <p className="text-[13px] text-ams-muted">No status changes recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {account.statusHistory.map((h) => (
                  <li key={h.id} className="rounded-lg border border-ams-line px-3 py-2.5 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      {h.from_status && <StatusPill status={h.from_status} />}
                      {h.from_status && <span className="text-ams-faint">→</span>}
                      <StatusPill status={h.to_status} />
                    </div>
                    {h.reason && (
                      <p className="mt-1.5 text-ams-muted">{h.reason}</p>
                    )}
                    <p className="mt-1 text-[11px] text-ams-faint">
                      {h.profiles?.full_name || 'System'}
                      {' · '}
                      {new Date(h.changed_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const { site } = useSite();
  const [search, setSearch] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fStaff, setFStaff] = useState('');
  const [fSt, setFSt] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [page, setPage] = useState(1);

  const { data: accounts = [], isLoading } = useAllAccounts();

  const staffOptions = useMemo(() => {
    const names = new Set();
    accounts.forEach((a) => {
      const s = String(a.staff || '').trim();
      if (s) names.add(s);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await api.get('/devices', { params: { limit: 200 } });
      return res.data?.data || [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let devCount = 0;
    let acctCount = 0;
    const cards = [];

    const sortedDevices = [...devices].sort(compareDeviceNames);

    sortedDevices.forEach((device) => {
      const siteKey = device.device_name?.startsWith('PP') ? 'pp' : 'my';
      if (site !== 'all' && siteKey !== site) return;

      const deviceAccounts = accounts
        .filter((a) => a.device_id === device.id)
        .sort((a, b) => {
          const d = channelSlotIndex(a.channel) - channelSlotIndex(b.channel);
          if (d !== 0) return d;
          return String(a.account_name || '').localeCompare(String(b.account_name || ''));
        });

      function acctMatch(a) {
        if (fBrand && resolveAccountBrand(a) !== fBrand) return false;
        if (fStaff && a.staff !== fStaff) return false;
        if (fSt && statusMeta(a.status).filter !== fSt) return false;
        if (q) {
          const hay = `${a.account_name} ${a.phone_number} ${a.staff} ${device.device_name}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }

      const devHit = q && device.device_name.toLowerCase().includes(q);
      const matched = devHit ? deviceAccounts : deviceAccounts.filter(acctMatch);

      if (!devHit && matched.length === 0) return;

      devCount += 1;
      acctCount += matched.length;

      cards.push({ device, siteKey, accounts: matched, allAccounts: deviceAccounts });
    });

    const orphanAccounts = accounts.filter((a) => {
      if (a.device_id) return false;
      if (site !== 'all' && a.siteKey !== site) return false;
      if (fBrand && resolveAccountBrand(a) !== fBrand) return false;
      if (fStaff && a.staff !== fStaff) return false;
      if (fSt && statusMeta(a.status).filter !== fSt) return false;
      if (q) {
        const hay = `${a.account_name} ${a.phone_number} ${a.staff}`.toLowerCase();
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
  }, [accounts, devices, search, site, fBrand, fStaff, fSt]);

  const totalPages = Math.max(1, Math.ceil(filtered.deviceCards.length / LEDGER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageCards = filtered.deviceCards.slice(
    (safePage - 1) * LEDGER_PAGE_SIZE,
    safePage * LEDGER_PAGE_SIZE,
  );
  const pageStart = filtered.deviceCards.length ? (safePage - 1) * LEDGER_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(safePage * LEDGER_PAGE_SIZE, filtered.deviceCards.length);

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

  const statusFilters = [
    ['', 'All statuses'],
    ['registering', 'Registering'],
    ['nurturing', 'Nurturing'],
    ['standby', 'Standby'],
    ['inuse', 'In Use'],
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

  const hasResults = filtered.deviceCards.length > 0 || filtered.orphanCard;

  return (
    <div>
      <PageHead
        title="Resource Ledger"
        description="Lookup by device, account, phone, brand, or Staff. Owner = who registered; Staff = business assignee (set by operators)."
      />

      <div className="page-filter-bar">
        <div className="page-filter-search">
          <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
          <input
            className="input"
            placeholder="Search device ID, account, staff, or phone…"
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
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={fStaff}
            onChange={(e) => setFStaff(e.target.value)}
            aria-label="Filter by staff"
          >
            <option value="">All staff</option>
            {staffOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
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

      {isLoading ? (
        <p className="py-10 text-center text-sm text-ams-faint">Loading ledger…</p>
      ) : !hasResults ? (
        <p className="py-10 text-center text-sm text-ams-faint">No devices or accounts match the filters.</p>
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
        {SITES[site].name} · {filtered.devCount} devices · {filtered.acctCount} accounts
      </p>
    </div>
  );
}
