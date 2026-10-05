import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import ConfirmDialog from '../components/ConfirmDialog';
import Toast from '../components/Toast';
import SimTableRow from '../components/SimTableRow';
import { useSite } from '../context/SiteContext';
import { SITES } from '../lib/sites';
import api from '../lib/api';
import { mapSimRow } from '../lib/resource-mappers';
import {
  daysLeftTagClass,
  expiryFromChargeDate,
  formatDaysLeft,
  formatTopupAmount,
  normalizeTopupCycleDays,
  SIM_ANOMALY_PLATFORMS,
  SIM_ANOMALY_REASONS,
  SIM_EXCEPTION_REASONS,
  SIM_LEDGER_STATUSES,
  SIM_TOPUP_CYCLE_DAYS,
  SIM_TOPUP_CYCLE_OPTIONS,
} from '../lib/sim-meta';
import { toastCopy } from '../lib/operator-copy';
import { telcoFilterOptionsForSite } from '../lib/telco-options';
import { BRAND_OPTIONS, inferBrand, inferBrandFromDevice } from '../lib/account-status-labels';
import { parseOperatorMeta } from '../lib/account-operator-meta';
import { useScrollRevealScrollbar } from '../hooks/useScrollRevealScrollbar';
import { usePhoneSyncMutation, usePhoneSyncRows } from '../hooks/useSupply';

function simDue(s) {
  if (s.ledger_status === 'stop_topup') return false;
  return !s.last_charged || s.days_left === 0;
}

function daysLeftFromChargeDate(chargeDate, cycleDays = SIM_TOPUP_CYCLE_DAYS) {
  const expiryIso = expiryFromChargeDate(chargeDate, cycleDays);
  if (!expiryIso) return null;
  const expiry = new Date(`${expiryIso}T12:00:00`);
  return Math.max(0, Math.ceil((expiry - Date.now()) / 86400000));
}

function mapSim(row) {
  return mapSimRow(row);
}

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function brandFromAccount(account) {
  if (!account) return null;
  const meta = parseOperatorMeta(account);
  const deviceName = account.devices?.device_name || account.device_name || '';
  return meta.brand
    || inferBrand(account.account_name)
    || inferBrandFromDevice(deviceName)
    || null;
}

/** Fill Bound Account / Brand when /sims omit them (stale API or empty embed). */
function enrichSimFromAccounts(sim, bySimId, byPhone) {
  const hardLinked = bySimId.has(sim.id);
  const hasAccount = sim.account_name && sim.account_name !== '—';
  if (hasAccount && sim.brand && (sim.account_linked || hardLinked)) {
    return {
      ...sim,
      account_linked: Boolean(sim.account_linked || hardLinked),
      bound_account_id: sim.bound_account_id || bySimId.get(sim.id)?.id || null,
    };
  }
  const acc = bySimId.get(sim.id)
    || byPhone.get(phoneDigits(sim.phone_number))
    || null;
  if (!acc) {
    return {
      ...sim,
      account_linked: Boolean(sim.account_linked || hardLinked),
      bound_account_id: sim.bound_account_id || null,
    };
  }
  return {
    ...sim,
    account_name: hasAccount ? sim.account_name : (acc.account_name || '—'),
    brand: sim.brand || brandFromAccount(acc),
    // Phone soft-match is display-only; delete lock needs a real sim_id link.
    account_linked: Boolean(sim.account_linked || hardLinked),
    bound_account_id: hardLinked
      ? (sim.bound_account_id || acc.id || null)
      : (sim.bound_account_id || null),
  };
}

function brandKey(row) {
  return row.brand || 'Unassigned';
}

const TOPUP_FIELD_LABELS = {
  charged_at: 'Charge date',
  amount: 'Amount',
  cycle_days: 'Cycle',
  plan: 'Plan',
};

function formatTopupField(field, value, site) {
  if (value == null || value === '') return '—';
  if (field === 'amount') return formatTopupAmount(value, site);
  if (field === 'cycle_days') return `${value}d`;
  return String(value);
}

function formatEditTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function canBulkCharge(row) {
  return row.ledger_status !== 'stop_topup';
}

const SIM_PAGE_SIZE = 20;

export default function SimsPage() {
  const { site } = useSite();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [telco, setTelco] = useState('all');
  const [brand, setBrand] = useState('all');
  const [ledgerStatus, setLedgerStatus] = useState('all');
  const [onlyDue, setOnlyDue] = useState(false);
  const [filterSoon, setFilterSoon] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [chargeMode, setChargeMode] = useState('charge'); // 'charge' = new top-up, 'edit' = correct latest
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [historySim, setHistorySim] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(null);
  const [unlinking, setUnlinking] = useState(false);
  const [exceptionSim, setExceptionSim] = useState(null);
  const [exceptionReason, setExceptionReason] = useState('topup_failed');
  const [exceptionDetail, setExceptionDetail] = useState('');
  const [anomalySim, setAnomalySim] = useState(null);
  const [anomalyReason, setAnomalyReason] = useState(SIM_ANOMALY_REASONS[0].value);
  const [anomalyPlatform, setAnomalyPlatform] = useState(SIM_ANOMALY_PLATFORMS[0].value);
  const [anomalyDetail, setAnomalyDetail] = useState('');
  const [refundDraft, setRefundDraft] = useState(null);
  const [chargeDate, setChargeDate] = useState('');
  const [amount, setAmount] = useState('');
  const [cycleDays, setCycleDays] = useState(String(SIM_TOPUP_CYCLE_DAYS));
  const [plan, setPlan] = useState('');
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('success');
  const [page, setPage] = useState(1);

  function showToast(message, tone = 'success') {
    setToastTone(tone);
    setToast(message);
    setTimeout(() => setToast(''), tone === 'success' ? 3500 : 4500);
  }

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
          _nc: Date.now(),
        },
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      return (res.data?.data || []).map(mapSim);
    },
    staleTime: 0,
    gcTime: 0,
    placeholderData: keepPreviousData,
  });

  const { data: ledgerAccounts = [] } = useQuery({
    queryKey: ['sims-bound-accounts'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 500 } });
      return res.data?.data || [];
    },
    staleTime: 60_000,
  });

  const siteRows = useMemo(() => {
    const bySimId = new Map();
    const byPhone = new Map();
    ledgerAccounts.forEach((a) => {
      if (a.sim_id) bySimId.set(a.sim_id, a);
      const digits = phoneDigits(a.phone_number);
      if (digits) byPhone.set(digits, a);
    });
    return allRows.map((row) => enrichSimFromAccounts(row, bySimId, byPhone));
  }, [allRows, ledgerAccounts]);

  const mismatchCount = useMemo(
    () => siteRows.filter((row) => syncBySimId.get(row.id)?.needs_action).length,
    [siteRows, syncBySimId],
  );

  const stats = useMemo(() => {
    const due = siteRows.filter(simDue).length;
    const soon = siteRows.filter((s) => (
      s.ledger_status !== 'stop_topup'
      && s.days_left != null
      && s.days_left <= 7
    )).length;
    return { due, soon, total: siteRows.length };
  }, [siteRows]);

  useEffect(() => {
    setSearch('');
    setOnlyDue(false);
    setFilterSoon(false);
    setOnlyMismatch(false);
    setTelco('all');
    setBrand('all');
    setLedgerStatus('all');
    setSelected(new Set());
    setPage(1);
  }, [site]);

  useEffect(() => {
    setPage(1);
  }, [search, telco, brand, ledgerStatus, onlyDue, filterSoon, onlyMismatch]);

  const searchQuery = search.trim().toLowerCase();

  const list = useMemo(() => {
    let rows = siteRows.filter((s) => telco === 'all' || s.carrier === telco);
    if (brand !== 'all') {
      rows = rows.filter((s) => brandKey(s) === brand);
    }
    if (ledgerStatus !== 'all') {
      rows = rows.filter((s) => (s.ledger_status || 'active') === ledgerStatus);
    }
    if (onlyDue) rows = rows.filter(simDue);
    if (filterSoon) {
      rows = rows.filter((s) => s.days_left != null && s.days_left <= 7 && s.ledger_status !== 'stop_topup');
    }
    if (onlyMismatch) {
      rows = rows.filter((s) => syncBySimId.get(s.id)?.needs_action);
    }
    if (searchQuery) {
      const digits = searchQuery.replace(/\D/g, '');
      rows = rows.filter((s) => {
        const phone = String(s.phone_number || '').toLowerCase();
        const account = String(s.account_name || '').toLowerCase();
        const carrier = String(s.carrier || '').toLowerCase();
        const location = String(s.location || '').toLowerCase();
        const b = brandKey(s).toLowerCase();
        const remark = String(s.remark || '').toLowerCase();
        if (phone.includes(searchQuery) || account.includes(searchQuery)
          || carrier.includes(searchQuery) || location.includes(searchQuery)
          || b.includes(searchQuery) || remark.includes(searchQuery)) {
          return true;
        }
        if (digits && phoneDigits(s.phone_number).includes(digits)) return true;
        return false;
      });
    }
    return rows.slice().sort((a, b) => {
      const ad = simDue(a) ? 0 : 1;
      const bd = simDue(b) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      const da = a.days_left == null ? Number.POSITIVE_INFINITY : a.days_left;
      const db = b.days_left == null ? Number.POSITIVE_INFINITY : b.days_left;
      return da - db;
    });
  }, [siteRows, searchQuery, telco, brand, ledgerStatus, onlyDue, filterSoon, onlyMismatch, syncBySimId]);

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(list.map((r) => r.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [list]);

  const openCharge = useCallback((row) => {
    setBulkOpen(false);
    setChargeMode('charge');
    setChargeDate(new Date().toISOString().slice(0, 10));
    setAmount(row.last_amount != null ? String(row.last_amount) : '');
    setCycleDays(String(normalizeTopupCycleDays(row.last_cycle_days)));
    setPlan(row.last_plan || '');
    setDrawer(row);
  }, []);

  const openEditTopup = useCallback((row) => {
    setBulkOpen(false);
    setChargeMode('edit');
    setChargeDate(row.last_charged || new Date().toISOString().slice(0, 10));
    setAmount(row.last_amount != null ? String(row.last_amount) : '');
    setCycleDays(String(normalizeTopupCycleDays(row.last_cycle_days)));
    setPlan(row.last_plan || '');
    setDrawer(row);
  }, []);

  const openBulkCharge = useCallback(() => {
    if (selected.size === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    setDrawer(null);
    setChargeDate(today);
    setAmount('');
    setCycleDays(String(SIM_TOPUP_CYCLE_DAYS));
    setPlan('');
    setBulkOpen(true);
  }, [selected.size]);

  const closeChargeDrawer = useCallback(() => {
    setDrawer(null);
    setBulkOpen(false);
  }, []);

  const openHistory = useCallback((row) => {
    setRefundDraft(null);
    setHistorySim(row);
  }, []);

  const openAnomaly = useCallback((row) => {
    setAnomalyReason(SIM_ANOMALY_REASONS[0].value);
    setAnomalyPlatform(SIM_ANOMALY_PLATFORMS[0].value);
    setAnomalyDetail('');
    setAnomalySim(row);
  }, []);

  const openException = useCallback((row) => {
    setExceptionReason('topup_failed');
    setExceptionDetail('');
    setExceptionSim(row);
  }, []);

  const requestDeleteSim = useCallback((row) => {
    setDeleteConfirm({
      id: row.id,
      phone: row.phone_number,
      title: 'Delete SIM from ledger?',
      message: `Remove ${row.phone_number} from the SIM Card Ledger? Top-up history for this number will also be removed.`,
    });
  }, []);

  const requestUnlinkSim = useCallback((row) => {
    const accountId = row.bound_account_id
      || syncBySimId.get(row.id)?.account_id
      || null;
    if (!accountId) {
      showToast('Cannot unlink — no bound account id found', 'error');
      return;
    }
    setUnlinkConfirm({
      id: row.id,
      accountId,
      phone: row.phone_number,
      accountName: row.account_name && row.account_name !== '—' ? row.account_name : null,
      title: 'Unlink SIM from account?',
      message: `One account = one SIM. Unlinking ${row.phone_number} retires `
        + `${row.account_name && row.account_name !== '—' ? row.account_name : 'its account'}: `
        + 'the account is removed from its device slot and from Resource Ledger. '
        + 'The SIM stays in this ledger, and status history (including bans) is kept for KPIs.',
    });
  }, [syncBySimId]);

  async function confirmDeleteSim() {
    if (!deleteConfirm?.id || deleting) return;
    setDeleting(true);
    try {
      await api.delete(`/sims/${deleteConfirm.id}`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteConfirm.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sim-topups'] });
      showToast(toastCopy.simDeleted(deleteConfirm.phone));
      setDeleteConfirm(null);
    } catch (e) {
      const msg = e.response?.status === 409
        ? toastCopy.simDeleteBlocked()
        : (e.response?.data?.error || e.message || 'Delete failed');
      showToast(msg, 'error');
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmUnlinkSim() {
    if (!unlinkConfirm?.accountId || unlinking) return;
    setUnlinking(true);
    try {
      await syncMut.mutateAsync({
        accountId: unlinkConfirm.accountId,
        action: 'unlink_sim',
        sim_id: unlinkConfirm.id,
      });
      qc.invalidateQueries({ queryKey: ['sims-bound-accounts'] });
      showToast(toastCopy.simUnlinked(unlinkConfirm.phone, unlinkConfirm.accountName));
      setUnlinkConfirm(null);
    } catch (e) {
      showToast(e?.response?.data?.error || e.message || 'Unlink failed', 'error');
      setUnlinkConfirm(null);
    } finally {
      setUnlinking(false);
    }
  }

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
      showToast(`Aligned — account now uses ${fixed}`);
    } catch (e) {
      showToast(e?.response?.data?.error || e.message || 'Align failed', 'error');
    } finally {
      setSyncBusyId(null);
    }
  }, [syncBySimId, syncMut]);

  const totalPages = Math.max(1, Math.ceil(list.length / SIM_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = list.slice((safePage - 1) * SIM_PAGE_SIZE, safePage * SIM_PAGE_SIZE);
  const pageStart = list.length ? (safePage - 1) * SIM_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(safePage * SIM_PAGE_SIZE, list.length);
  const pageSelectableIds = useMemo(
    () => pageRows.filter(canBulkCharge).map((r) => r.id),
    [pageRows],
  );
  const allSelectableIds = useMemo(
    () => list.filter(canBulkCharge).map((r) => r.id),
    [list],
  );
  const allPageSelected = pageSelectableIds.length > 0
    && pageSelectableIds.every((id) => selected.has(id));
  const somePageSelected = pageSelectableIds.some((id) => selected.has(id));
  const allFilteredSelected = allSelectableIds.length > 0
    && allSelectableIds.every((id) => selected.has(id));
  const selectedRows = useMemo(
    () => list.filter((r) => selected.has(r.id) && canBulkCharge(r)),
    [list, selected],
  );
  const chargeDrawerOpen = !!drawer || bulkOpen;

  const toggleSelect = useCallback((id, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectPage = useCallback((on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      pageSelectableIds.forEach((id) => {
        if (on) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }, [pageSelectableIds]);

  const selectAllFiltered = useCallback(() => {
    setSelected(new Set(allSelectableIds));
  }, [allSelectableIds]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const previewDaysLeft = useMemo(() => {
    if (!chargeDrawerOpen) return 0;
    if (chargeDate) return daysLeftFromChargeDate(chargeDate, cycleDays);
    return drawer?.days_left || 0;
  }, [chargeDrawerOpen, drawer, chargeDate, cycleDays]);

  const previewExpiry = useMemo(() => {
    if (!chargeDate) return null;
    return expiryFromChargeDate(chargeDate, cycleDays);
  }, [chargeDate, cycleDays]);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['sim-topups', historySim?.id],
    queryFn: async () => {
      const res = await api.get(`/sims/${historySim.id}/topups`);
      return res.data;
    },
    enabled: Boolean(historySim?.id),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/sims/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sim-topups'] });
    },
  });

  const exceptionMut = useMutation({
    mutationFn: ({ id, body }) => api.post(`/sims/${id}/exception`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sims'] });
    },
  });

  const editTopupMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/sims/${id}/topups/latest`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sim-topups'] });
    },
  });

  const anomalyMut = useMutation({
    mutationFn: ({ id, body }) => api.post(`/sims/${id}/anomaly`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['bans'] });
    },
  });

  const refundMut = useMutation({
    mutationFn: ({ id, topupId, body }) => api.post(`/sims/${id}/topups/${topupId}/refund`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sim-topups'] });
    },
  });

  function buildChargeBody() {
    const date = chargeDate || new Date().toISOString().slice(0, 10);
    const amountValue = amount === '' ? null : Number(amount);
    if (amount !== '' && !Number.isFinite(amountValue)) {
      return { error: 'Enter a valid top-up amount' };
    }
    return {
      body: {
        last_charged: date,
        amount: amountValue,
        cycle_days: normalizeTopupCycleDays(cycleDays),
        plan: plan.trim() || null,
        status: 'OK',
      },
      date,
    };
  }

  function submitCharge() {
    if (!drawer) return;
    const built = buildChargeBody();
    if (built.error) {
      showToast(built.error, 'error');
      return;
    }
    if (chargeMode === 'edit') {
      const { last_charged, amount: amt, cycle_days, plan: planText } = built.body;
      editTopupMut.mutate(
        { id: drawer.id, body: { last_charged, amount: amt, cycle_days, plan: planText } },
        {
          onSuccess: (res) => {
            showToast(res?.data?.topup_changed === false
              ? `No changes for ${drawer.phone_number}`
              : `Top-up corrected for ${drawer.phone_number}`);
            closeChargeDrawer();
          },
          onError: (e) => {
            showToast(e?.response?.data?.error || e.message || 'Update failed', 'error');
          },
        },
      );
      return;
    }
    patchMut.mutate(
      { id: drawer.id, body: built.body },
      {
        onSuccess: () => {
          showToast(toastCopy.simTopUp(drawer.phone_number, built.date));
          closeChargeDrawer();
        },
      },
    );
  }

  async function submitBulkCharge() {
    if (selectedRows.length === 0) {
      showToast('Select at least one SIM to mark charged', 'error');
      return;
    }
    const built = buildChargeBody();
    if (built.error) {
      showToast(built.error, 'error');
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const row of selectedRows) {
      try {
        await api.patch(`/sims/${row.id}`, built.body);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    qc.invalidateQueries({ queryKey: ['sims'] });
    qc.invalidateQueries({ queryKey: ['sim-topups'] });
    if (ok) {
      setSelected(new Set());
      closeChargeDrawer();
    }
    showToast(
      fail
        ? `Bulk top-up: ${ok} saved, ${fail} failed`
        : `Bulk top-up: ${ok} SIM${ok === 1 ? '' : 's'} · ${built.date}`,
      fail ? 'warn' : 'success',
    );
  }

  function submitAnomaly() {
    if (!anomalySim) return;
    anomalyMut.mutate(
      {
        id: anomalySim.id,
        body: {
          reason: anomalyReason,
          platform: anomalyPlatform,
          detail: anomalyDetail.trim() || null,
        },
      },
      {
        onSuccess: () => {
          showToast(`SIM Card Anomaly logged — ${anomalySim.phone_number} moved to Pending Review`);
          setAnomalySim(null);
        },
        onError: (e) => {
          showToast(e?.response?.data?.error || e.message || 'Failed to log SIM Card Anomaly', 'error');
        },
      },
    );
  }

  function submitException() {
    if (!exceptionSim) return;
    exceptionMut.mutate(
      {
        id: exceptionSim.id,
        body: {
          reason: exceptionReason,
          detail: exceptionDetail.trim() || null,
        },
      },
      {
        onSuccess: (res) => {
          const st = res?.data?.ledger_status || res?.ledger_status;
          showToast(
            st === 'pending_review'
              ? `Exception saved — ${exceptionSim.phone_number} moved to Pending Review`
              : `Exception saved for ${exceptionSim.phone_number}`,
          );
          setExceptionSim(null);
        },
        onError: (e) => {
          showToast(e?.response?.data?.error || e.message || 'Exception failed', 'error');
        },
      },
    );
  }

  function submitStatus(row, nextStatus) {
    patchMut.mutate(
      { id: row.id, body: { ledger_status: nextStatus } },
      {
        onSuccess: () => {
          showToast(`Status → ${SIM_LEDGER_STATUSES.find((s) => s.value === nextStatus)?.label || nextStatus}`);
        },
        onError: (e) => {
          showToast(e?.response?.data?.error || e.message || 'Status update failed', 'error');
        },
      },
    );
  }

  function submitRefund() {
    if (!historySim || !refundDraft?.topupId) return;
    const amountValue = refundDraft.amount === '' || refundDraft.amount == null
      ? null
      : Number(refundDraft.amount);
    if (refundDraft.amount !== '' && refundDraft.amount != null && !Number.isFinite(amountValue)) {
      showToast('Enter a valid refund amount', 'error');
      return;
    }
    refundMut.mutate(
      {
        id: historySim.id,
        topupId: refundDraft.topupId,
        body: {
          amount: amountValue,
          reason: refundDraft.reason?.trim() || null,
        },
      },
      {
        onSuccess: () => {
          showToast(`Refund recorded for ${historySim.phone_number}`);
          setRefundDraft(null);
        },
        onError: (e) => {
          showToast(e?.response?.data?.error || e.message || 'Refund failed', 'error');
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
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-ink">{list.length}</span>
            <span>shown ·</span>
            <span className="font-semibold text-ams-ink">{stats.total}</span>
            <span>at site</span>
            {isFetching && !showTableLoading ? <span>· updating…</span> : null}
          </div>
        )}
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

      <div className="page-filter-bar">
        <div className="page-filter-search">
          <Search size={15} className="page-filter-search-icon" strokeWidth={2} />
          <input
            className="input"
            type="search"
            placeholder="Search phone, account, brand, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search SIM ledger"
          />
        </div>
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={telco}
            onChange={(e) => setTelco(e.target.value)}
            aria-label="Filter by telco"
          >
            {telcoSegOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            aria-label="Filter by brand"
          >
            <option value="all">All brands</option>
            {BRAND_OPTIONS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
            <option value="Unassigned">Unassigned</option>
          </select>
        </label>
        <label className="page-filter-chip">
          <select
            className="page-filter-chip-select"
            value={ledgerStatus}
            onChange={(e) => setLedgerStatus(e.target.value)}
            aria-label="Filter by SIM status"
          >
            <option value="all">All statuses</option>
            {SIM_LEDGER_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="page-filter-chip page-filter-chip--toggle">
          <input
            type="checkbox"
            className="accent-ams-accent"
            checked={onlyDue}
            onChange={(e) => {
              setOnlyDue(e.target.checked);
              if (!e.target.checked) setFilterSoon(false);
            }}
          />
          <span>Due only</span>
        </label>
        <label className="page-filter-chip page-filter-chip--toggle">
          <input
            type="checkbox"
            className="accent-ams-accent"
            checked={onlyMismatch}
            onChange={(e) => {
              setOnlyMismatch(e.target.checked);
              if (e.target.checked) {
                setOnlyDue(false);
                setFilterSoon(false);
              }
            }}
          />
          <span>Align issues</span>
        </label>
      </div>

      <div className="ip-bulkbar mb-3">
        <div className="ip-bulkbar-start">
          <label className="ip-bulkbar-check">
            <input
              type="checkbox"
              className="ams-check"
              checked={allPageSelected}
              ref={(el) => {
                if (el) el.indeterminate = somePageSelected && !allPageSelected;
              }}
              onChange={(e) => toggleSelectPage(e.target.checked)}
              disabled={pageSelectableIds.length === 0}
            />
            Select page
          </label>
          {!allFilteredSelected && allSelectableIds.length > pageSelectableIds.length && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={selectAllFiltered}
            >
              Select all {allSelectableIds.length}
            </button>
          )}
          <span
            className={`ip-bulkbar-meta${selected.size > 0 ? ' is-visible' : ''}`}
            aria-hidden={selected.size === 0}
          >
            <span className="ip-bulkbar-count">{selected.size}</span>
            selected
          </span>
          <div
            className={`ip-bulkbar-actions${selected.size > 0 ? ' is-visible' : ''}`}
            aria-hidden={selected.size === 0}
          >
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openBulkCharge}
              tabIndex={selected.size > 0 ? 0 : -1}
            >
              Mark Charged
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(new Set())}
              tabIndex={selected.size > 0 ? 0 : -1}
            >
              Clear
            </button>
          </div>
        </div>
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
              <table className="data-table data-table--sims">
                <thead>
                  <tr>
                    <th className="col-check">
                      <input
                        type="checkbox"
                        className="ams-check"
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = somePageSelected && !allPageSelected;
                        }}
                        onChange={(e) => toggleSelectPage(e.target.checked)}
                        disabled={pageSelectableIds.length === 0}
                        aria-label="Select all on this page"
                      />
                    </th>
                    <th>Phone</th>
                    <th>Telco</th>
                    <th>Location</th>
                    <th>Bound Account</th>
                    <th>Brand</th>
                    <th>SIM Status</th>
                    <th>Expiry</th>
                    <th>Top-up Status</th>
                    <th>Remark</th>
                    <th className="col-action col-action--wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 ? (
                    <tr><td colSpan={11} className="empty-cell">No SIM cards match the filters.</td></tr>
                  ) : pageRows.map((row) => (
                    <SimTableRow
                      key={row.id}
                      row={row}
                      selected={selected.has(row.id)}
                      selectable={canBulkCharge(row)}
                      onToggleSelect={toggleSelect}
                      syncRow={syncBySimId.get(row.id)}
                      syncBusy={syncBusyId === row.id}
                      onAlign={handleAlign}
                      onCharge={openCharge}
                      onEditTopup={openEditTopup}
                      onHistory={openHistory}
                      onException={openException}
                      onAnomaly={openAnomaly}
                      onDelete={requestDeleteSim}
                      onUnlink={requestUnlinkSim}
                      onStatusChange={submitStatus}
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
        open={chargeDrawerOpen}
        title={bulkOpen
          ? `Bulk Mark Charged (${selectedRows.length})`
          : chargeMode === 'edit' ? 'Update Last Top-up' : 'Record Top-up'}
        onClose={closeChargeDrawer}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={closeChargeDrawer} disabled={bulkBusy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={bulkOpen ? submitBulkCharge : submitCharge}
              disabled={bulkOpen ? bulkBusy : (patchMut.isPending || editTopupMut.isPending)}
            >
              {bulkOpen
                ? (bulkBusy ? `Saving ${selectedRows.length}…` : `Save ${selectedRows.length} SIM${selectedRows.length === 1 ? '' : 's'}`)
                : (patchMut.isPending || editTopupMut.isPending)
                  ? 'Saving…'
                  : chargeMode === 'edit' ? 'Save changes' : 'Save'}
            </button>
          </>
        )}
      >
        {chargeDrawerOpen && (
          <>
            <p className="drawer-hint">
              {bulkOpen
                ? 'Shared charge date, amount, and plan cycle will be applied to every selected SIM. Each save is written to the audit log individually.'
                : chargeMode === 'edit'
                  ? 'Correct the most recent top-up record — no new top-up is added. The change (old → new) is kept in Top-up history.'
                  : 'Top-up is done manually on the telco platform. AMS records the charge date, amount, and plan cycle for bookkeeping.'}
            </p>
            {bulkOpen ? (
              <div className="drawer-locked">
                <div className="drawer-locked-label">Selected SIMs</div>
                <div className="drawer-locked-value">
                  {selectedRows.length} number{selectedRows.length === 1 ? '' : 's'}
                  <span className="drawer-locked-meta">
                    {selectedRows.slice(0, 4).map((r) => r.phone_number).join(', ')}
                    {selectedRows.length > 4 ? ` +${selectedRows.length - 4} more` : ''}
                  </span>
                </div>
              </div>
            ) : drawer && (
              <>
                <div className="drawer-locked">
                  <div className="drawer-locked-label">Phone · Telco</div>
                  <div className="drawer-locked-value drawer-locked-value--mono">
                    {drawer.phone_number}
                    <span className="drawer-locked-meta">{drawer.carrier}</span>
                  </div>
                </div>
                <div className="drawer-locked">
                  <div className="drawer-locked-label">Bound account · Brand · Location</div>
                  <div className="drawer-locked-value">
                    {drawer.account_name || '—'}
                    {' · '}
                    {drawer.brand || 'Unassigned'}
                    {' · '}
                    {drawer.site_name || SITES[drawer.site]?.name || drawer.location || '—'}
                  </div>
                </div>
              </>
            )}
            <div className="drawer-locked">
              <div className="drawer-locked-label">Expiry preview</div>
              <div className="drawer-locked-value">
                <span className={`due-tag ${daysLeftTagClass(previewDaysLeft)}`}>
                  {formatDaysLeft(previewDaysLeft)}
                </span>
                {previewExpiry && (
                  <span className="drawer-locked-meta"> until {previewExpiry} (+{normalizeTopupCycleDays(cycleDays)}d)</span>
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
            <label className="drawer-field">
              <span className="drawer-label">Top-up amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input font-mono"
                placeholder="e.g. 10"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="drawer-field">
              <span className="drawer-label">Plan cycle</span>
              <select
                className="input"
                value={cycleDays}
                onChange={(e) => setCycleDays(e.target.value)}
              >
                {SIM_TOPUP_CYCLE_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </label>
            <label className="drawer-field">
              <span className="drawer-label">Plan / remark (optional)</span>
              <input
                type="text"
                className="input"
                placeholder="e.g. Hotlink 30-day"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
              />
            </label>
          </>
        )}
      </Drawer>

      <Drawer
        open={!!historySim}
        title="Top-up history"
        onClose={() => { setRefundDraft(null); setHistorySim(null); }}
        footer={(
          <button
            type="button"
            className="btn btn-ghost flex-1"
            onClick={() => { setRefundDraft(null); setHistorySim(null); }}
          >
            Close
          </button>
        )}
      >
        {historySim && (
          <div className="space-y-4">
            <div className="drawer-locked">
              <div className="drawer-locked-label">Phone · Brand</div>
              <div className="drawer-locked-value drawer-locked-value--mono">
                {historySim.phone_number}
                <span className="drawer-locked-meta">{historySim.brand || 'Unassigned'}</span>
              </div>
            </div>
            {historyLoading ? (
              <p className="text-sm text-ams-faint">Loading history…</p>
            ) : (historyData?.topups || []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-ams-line px-3 py-6 text-center text-[13px] text-ams-faint">
                No top-up records yet. Use Mark Charged to add the first one.
              </p>
            ) : (
              <ul className="space-y-2">
                {(historyData.topups || []).map((tu) => {
                  const isRefunding = refundDraft?.topupId === tu.id;
                  return (
                    <li
                      key={tu.id}
                      className="rounded-lg border border-ams-line px-3 py-2.5 text-[13px]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-ams-ink">{tu.charged_at}</div>
                          <div className="mt-0.5 text-[12px] text-ams-muted">
                            {tu.cycle_days || 30}d cycle
                            {tu.expiry_date ? ` · expires ${tu.expiry_date}` : ''}
                            {tu.plan ? ` · ${tu.plan}` : ''}
                          </div>
                          {tu.created_by && (
                            <div className="mt-0.5 text-[11px] text-ams-faint">by {tu.created_by}</div>
                          )}
                          {(tu.edits || []).map((ed, i) => (
                            <div key={`${ed.at}-${i}`} className="mt-1 text-[11.5px] leading-snug text-ams-warn">
                              <span className="font-medium">
                                Edited by {ed.by || '—'} · {formatEditTime(ed.at)}
                              </span>
                              {Object.entries(ed.changes || {}).map(([field, ch]) => (
                                <div key={field} className="text-ams-muted">
                                  {TOPUP_FIELD_LABELS[field] || field}: {formatTopupField(field, ch.from, historySim.site)} → {formatTopupField(field, ch.to, historySim.site)}
                                </div>
                              ))}
                            </div>
                          ))}
                          {tu.refund && (
                            <div className="mt-1 text-[12px] text-ams-danger">
                              Refunded {formatTopupAmount(tu.refund.amount, historySim.site)}
                              {tu.refund.reason ? ` · ${tu.refund.reason}` : ''}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[13px] font-semibold text-ams-ink">
                            {formatTopupAmount(tu.amount, historySim.site)}
                          </div>
                          {!tu.refund && !isRefunding && (
                            <button
                              type="button"
                              className="btn btn-outline-warn btn-sm mt-1"
                              onClick={() => setRefundDraft({
                                topupId: tu.id,
                                amount: tu.amount == null ? '' : String(tu.amount),
                                reason: '',
                              })}
                            >
                              Mark Refund
                            </button>
                          )}
                        </div>
                      </div>
                      {isRefunding && (
                        <div className="mt-3 space-y-2 border-t border-ams-line pt-3">
                          <label className="drawer-field">
                            <span className="drawer-label">Refund amount</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input font-mono"
                              value={refundDraft.amount}
                              onChange={(e) => setRefundDraft((d) => ({ ...d, amount: e.target.value }))}
                            />
                          </label>
                          <label className="drawer-field">
                            <span className="drawer-label">Reason (optional)</span>
                            <input
                              type="text"
                              className="input"
                              placeholder="e.g. telco refund / duplicate"
                              value={refundDraft.reason}
                              onChange={(e) => setRefundDraft((d) => ({ ...d, reason: e.target.value }))}
                            />
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setRefundDraft(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={submitRefund}
                              disabled={refundMut.isPending}
                            >
                              {refundMut.isPending ? 'Saving…' : 'Confirm Refund'}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!exceptionSim}
        title="Unable to Top Up"
        onClose={() => setExceptionSim(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setExceptionSim(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitException}
              disabled={exceptionMut.isPending}
            >
              {exceptionMut.isPending ? 'Saving…' : 'Save Exception'}
            </button>
          </>
        )}
      >
        {exceptionSim && (
          <>
            <p className="drawer-hint">
              Record why this number could not be topped up. If the reason is account ban pending confirmation, SIM Status switches to Pending Review for R&amp;M.
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Phone · Telco · Brand</div>
              <div className="drawer-locked-value drawer-locked-value--mono">
                {exceptionSim.phone_number}
                <span className="drawer-locked-meta">
                  {exceptionSim.carrier}
                  {' · '}
                  {exceptionSim.brand || 'Unassigned'}
                </span>
              </div>
            </div>
            <label className="drawer-field">
              <span className="drawer-label">Reason</span>
              <select
                className="input"
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
              >
                {SIM_EXCEPTION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="drawer-field">
              <span className="drawer-label">Detail (optional)</span>
              <input
                type="text"
                className="input"
                placeholder="e.g. telco error message"
                value={exceptionDetail}
                onChange={(e) => setExceptionDetail(e.target.value)}
              />
            </label>
          </>
        )}
      </Drawer>

      <Drawer
        open={!!anomalySim}
        title="SIM Card Anomaly"
        onClose={() => setAnomalySim(null)}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setAnomalySim(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitAnomaly}
              disabled={anomalyMut.isPending}
            >
              {anomalyMut.isPending ? 'Saving…' : 'Log Anomaly'}
            </button>
          </>
        )}
      >
        {anomalySim && (
          <>
            <p className="drawer-hint">
              The card itself failed verification (WhatsApp or Telegram). It is counted against the
              carrier for anomaly-rate tracking and SIM Status switches to Pending Review.
              For a WhatsApp account that must go to Recovery, use SIM Anomaly on the account in Resource Ledger.
            </p>
            <div className="drawer-locked">
              <div className="drawer-locked-label">Phone · Carrier · Account</div>
              <div className="drawer-locked-value drawer-locked-value--mono">
                {anomalySim.phone_number}
                <span className="drawer-locked-meta">
                  {anomalySim.carrier}
                  {' · '}
                  {anomalySim.account_name || '—'}
                </span>
              </div>
            </div>
            <label className="drawer-field">
              <span className="drawer-label">Platform</span>
              <select
                className="input"
                value={anomalyPlatform}
                onChange={(e) => setAnomalyPlatform(e.target.value)}
              >
                {SIM_ANOMALY_PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="drawer-field">
              <span className="drawer-label">Reason</span>
              <select
                className="input"
                value={anomalyReason}
                onChange={(e) => setAnomalyReason(e.target.value)}
              >
                {SIM_ANOMALY_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="drawer-field">
              <span className="drawer-label">Detail (optional)</span>
              <input
                type="text"
                className="input"
                placeholder="e.g. carrier SMS, Telegram account name"
                value={anomalyDetail}
                onChange={(e) => setAnomalyDetail(e.target.value)}
              />
            </label>
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!deleteConfirm}
        title={deleteConfirm?.title || 'Delete SIM?'}
        message={deleteConfirm?.message || ''}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        danger
        onConfirm={confirmDeleteSim}
        onCancel={() => !deleting && setDeleteConfirm(null)}
      />

      <ConfirmDialog
        open={!!unlinkConfirm}
        title={unlinkConfirm?.title || 'Unlink SIM?'}
        message={unlinkConfirm?.message || ''}
        confirmLabel={unlinking ? 'Unlinking…' : 'Unlink & retire'}
        danger
        onConfirm={confirmUnlinkSim}
        onCancel={() => !unlinking && setUnlinkConfirm(null)}
      />

      <Toast open={!!toast} message={toast} tone={toastTone} onClose={() => setToast('')} />
    </div>
  );
}
