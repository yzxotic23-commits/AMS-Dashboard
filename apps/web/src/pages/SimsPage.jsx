import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import Toast from '../components/Toast';
import SegControl from '../components/SegControl';
import SimTableRow from '../components/SimTableRow';
import { useSite } from '../context/SiteContext';
import { SITES } from '../lib/sites';
import api from '../lib/api';
import { mapSimRow } from '../lib/resource-mappers';
import { expiryFromChargeDate } from '../lib/sim-meta';
import { toastCopy } from '../lib/operator-copy';
import { telcoFilterOptionsForSite } from '../lib/telco-options';
import { useScrollRevealScrollbar } from '../hooks/useScrollRevealScrollbar';
import { usePhoneSyncMutation, usePhoneSyncRows } from '../hooks/useSupply';

function simDue(s) {
  return !s.last_charged;
}

function dueTag(days) {
  if (days <= 3) return 'due-soon';
  if (days <= 7) return 'due-mid';
  return 'due-far';
}

function dueLabel(days) {
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function daysLeftFromChargeDate(chargeDate) {
  const expiryIso = expiryFromChargeDate(chargeDate);
  if (!expiryIso) return 0;
  const expiry = new Date(`${expiryIso}T12:00:00`);
  return Math.max(0, Math.ceil((expiry - Date.now()) / 86400000));
}

function mapSim(row) {
  return mapSimRow(row);
}

const SIM_PAGE_SIZE = 20;

export default function SimsPage() {
  const { site } = useSite();
  const qc = useQueryClient();
  const [telco, setTelco] = useState('all');
  const [onlyDue, setOnlyDue] = useState(false);
  const [filterSoon, setFilterSoon] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [chargeDate, setChargeDate] = useState('');
  const [toast, setToast] = useState('');
  const [page, setPage] = useState(1);

  const telcoSegOptions = useMemo(() => telcoFilterOptionsForSite(), []);

  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [syncBusyId, setSyncBusyId] = useState(null);
  const tableScrollRef = useScrollRevealScrollbar();

  function syncActionForIssue(issue) {
    if (issue === 'phone_mismatch' || issue === 'missing_sim') return 'copy_sim_to_account';
    return 'link_sim';
  }

  const { data: syncData } = usePhoneSyncRows(site);
  const syncMut = usePhoneSyncMutation();

  const syncBySimId = useMemo(() => {
    const map = new Map();
    (syncData?.data || []).forEach((row) => {
      if (row.sim_id) map.set(row.sim_id, row);
    });
    return map;
  }, [syncData]);

  const { data: allRows = [], isLoading, isFetching } = useQuery({
    queryKey: ['sims', site],
    queryFn: async () => {
      const res = await api.get('/sims', {
        params: {
          limit: 200,
          ...(site !== 'all' ? { site } : {}),
        },
      });
      return (res.data?.data || []).map(mapSim);
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const siteRows = allRows;

  const mismatchCount = useMemo(
    () => siteRows.filter((row) => syncBySimId.get(row.id)?.needs_action).length,
    [siteRows, syncBySimId],
  );

  const stats = useMemo(() => {
    const due = siteRows.filter(simDue).length;
    const soon = siteRows.filter((s) => simDue(s) && s.days_left <= 7).length;
    return { due, soon, total: siteRows.length };
  }, [siteRows]);

  useEffect(() => {
    setOnlyDue(false);
    setFilterSoon(false);
    setOnlyMismatch(false);
    setPage(1);
  }, [site]);

  useEffect(() => {
    setPage(1);
  }, [telco, onlyDue, filterSoon, onlyMismatch]);

  const list = useMemo(() => {
    let rows = siteRows.filter((s) => telco === 'all' || s.carrier === telco);
    if (onlyDue || filterSoon) rows = rows.filter(simDue);
    if (filterSoon) rows = rows.filter((s) => s.days_left <= 7);
    if (onlyMismatch) {
      rows = rows.filter((s) => syncBySimId.get(s.id)?.needs_action);
    }
    return rows.slice().sort((a, b) => {
      const ad = simDue(a) ? 0 : 1;
      const bd = simDue(b) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.days_left - b.days_left;
    });
  }, [siteRows, telco, onlyDue, filterSoon, onlyMismatch, syncBySimId]);

  const openCharge = useCallback((row) => {
    const today = new Date().toISOString().slice(0, 10);
    setChargeDate(row.last_charged || today);
    setDrawer(row);
  }, []);

  const handleAlign = useCallback(async (row) => {
    const syncRow = syncBySimId.get(row.id);
    if (!syncRow?.account_id) return;
    setSyncBusyId(row.id);
    try {
      await syncMut.mutateAsync({
        accountId: syncRow.account_id,
        action: syncActionForIssue(syncRow.issue),
        sim_id: row.id,
      });
      const fixed = syncRow.sim_phone || row.phone_number;
      setToast(`Aligned — account now uses ${fixed}`);
      setTimeout(() => setToast(''), 3500);
    } catch (e) {
      setToast(e?.response?.data?.error || e.message || 'Align failed');
    } finally {
      setSyncBusyId(null);
    }
  }, [syncBySimId, syncMut]);

  const totalPages = Math.max(1, Math.ceil(list.length / SIM_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = list.slice((safePage - 1) * SIM_PAGE_SIZE, safePage * SIM_PAGE_SIZE);
  const pageStart = list.length ? (safePage - 1) * SIM_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(safePage * SIM_PAGE_SIZE, list.length);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const previewDaysLeft = useMemo(() => {
    if (!drawer) return 0;
    if (chargeDate) return daysLeftFromChargeDate(chargeDate);
    return drawer.days_left;
  }, [drawer, chargeDate]);

  const patchMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/sims/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sims'] }),
  });

  function submitCharge() {
    if (!drawer) return;
    const date = chargeDate || new Date().toISOString().slice(0, 10);
    patchMut.mutate(
      { id: drawer.id, body: { last_charged: date, status: 'OK' } },
      {
        onSuccess: () => {
          setToast(toastCopy.simTopUp(drawer.phone_number, date));
          setDrawer(null);
          setTimeout(() => setToast(''), 3500);
        },
      },
    );
  }

  const showTableLoading = isLoading && !allRows.length;

  return (
    <div>
      <PageHead
        title="SIM Card Ledger"
        description="Top-up tracking for registered numbers. Numbers enter here after a successful Register result."
      />

      <div className="sim-attn mb-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          className="sim-attn-card sim-attn-danger"
          onClick={() => { setOnlyDue(true); setFilterSoon(false); }}
        >
          <span className="sim-attn-num">{stats.due}</span>
          <div className="text-left text-[13px] leading-snug">
            need top-up
            <div className="text-[11.5px] opacity-80">prioritize those expiring soon</div>
          </div>
        </button>
        <button
          type="button"
          className="sim-attn-card sim-attn-calm"
          onClick={() => { setFilterSoon(true); setOnlyDue(true); }}
        >
          <span className="sim-attn-num">{stats.soon}</span>
          <div className="text-left text-[13px] leading-snug">
            expiring within 7 days
            <div className="text-[11.5px] opacity-80">top these up first</div>
          </div>
        </button>
        <button
          type="button"
          className={`sim-attn-card${mismatchCount > 0 ? ' sim-attn-calm' : ''}`}
          onClick={() => { setOnlyMismatch(true); setOnlyDue(false); setFilterSoon(false); }}
          disabled={mismatchCount === 0}
        >
          <span className="sim-attn-num">{mismatchCount}</span>
          <div className="text-left text-[13px] leading-snug">
            phone align needed
            <div className="text-[11.5px] opacity-80">click account name in table</div>
          </div>
        </button>
      </div>

      <div className="sim-toolbar mb-4 flex flex-wrap items-center gap-3">
        <SegControl
          value={telco}
          onChange={(v) => setTelco(v)}
          size="sm"
          variant="notion"
          options={telcoSegOptions}
        />
        <label className="flex items-center gap-2 text-[13px] text-ams-muted">
          <input
            type="checkbox"
            checked={onlyMismatch}
            onChange={(e) => {
              setOnlyMismatch(e.target.checked);
              if (e.target.checked) {
                setOnlyDue(false);
                setFilterSoon(false);
              }
            }}
          />
          Alignment issues only
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ams-muted">
          <input
            type="checkbox"
            checked={onlyDue}
            onChange={(e) => { setOnlyDue(e.target.checked); if (!e.target.checked) setFilterSoon(false); }}
          />
          Show due only
        </label>
        <span className="ml-auto text-[13px] text-ams-faint">
          {list.length} SIM{list.length !== 1 ? 's' : ''} · {stats.total} at site
          {isFetching && !showTableLoading ? ' · updating…' : ''}
        </span>
      </div>

      <div className="data-panel card overflow-hidden">
        {showTableLoading ? (
          <p className="p-8 text-center text-sm text-ams-faint">Loading…</p>
        ) : (
          <>
            <div
              ref={tableScrollRef}
              className="data-table-wrap data-table-wrap--sticky scroll-reveal-scrollbar scroll-reveal-scrollbar--compact"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Phone</th>
                    <th>Telco</th>
                    <th>Location</th>
                    <th>Bound Account</th>
                    <th>Expiry</th>
                    <th>Top-up Status</th>
                    <th className="col-action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 ? (
                    <tr><td colSpan={7} className="empty-cell">No SIM cards match the filters.</td></tr>
                  ) : pageRows.map((row) => (
                    <SimTableRow
                      key={row.id}
                      row={row}
                      syncRow={syncBySimId.get(row.id)}
                      syncBusy={syncBusyId === row.id}
                      onAlign={handleAlign}
                      onCharge={openCharge}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > SIM_PAGE_SIZE && (
              <div className="tk-pager px-4 pb-4">
                <p className="tk-pager-meta">
                  Showing {pageStart}–{pageEnd} of {list.length}
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
        )}
      </div>

      <Drawer
        open={!!drawer}
        title="Record Top-up"
        onClose={() => setDrawer(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDrawer(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={submitCharge}>Save</button>
          </>
        )}
      >
        {drawer && (
          <>
            <p className="drawer-hint">
              Top-up is done manually on the telco platform. AMS only records when it was charged.
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Phone · Telco</div>
              <div className="drawer-locked-value drawer-locked-value--mono">
                {drawer.phone_number}
                <span className="drawer-locked-meta">{drawer.carrier}</span>
              </div>
            </div>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Bound account · Location</div>
              <div className="drawer-locked-value">
                {drawer.account_name || '—'} · {drawer.site_name || SITES[drawer.site]?.name || drawer.location || '—'}
              </div>
            </div>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Expiry preview</div>
              <div className="drawer-locked-value">
                <span className={`due-tag ${dueTag(previewDaysLeft)}`}>{dueLabel(previewDaysLeft)}</span>
                {chargeDate && (
                  <span className="drawer-locked-meta"> until {expiryFromChargeDate(chargeDate)}</span>
                )}
              </div>
            </div>
            <label className="drawer-field">
              <span className="drawer-label">Charge Date</span>
              <input
                type="date"
                className="input font-mono"
                value={chargeDate}
                onChange={(e) => setChargeDate(e.target.value)}
              />
            </label>
          </>
        )}
      </Drawer>

      <Toast open={!!toast} message={toast} tone="success" onClose={() => setToast('')} />
    </div>
  );
}
