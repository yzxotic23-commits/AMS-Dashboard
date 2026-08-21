import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { accountToOperatorRow } from '../lib/account-operator-meta';
import { apiDateParams } from '../lib/governanceDateRange';
import { useAuth } from '../context/AuthContext';

function dateQueryParams(dateRange) {
  if (!dateRange?.from || !dateRange?.to) return {};
  return apiDateParams(dateRange.from, dateRange.to);
}

function mapStandbyRows(accounts, site = 'all') {
  return (accounts || [])
    .map(accountToOperatorRow)
    .filter((a) => site === 'all' || a.siteKey === site)
    .map((a) => ({
      id: a.id,
      account_name: a.account_name,
      phone_number: a.phone_number || '',
      sim: a.sim || '',
      brand: a.brand || '',
      siteKey: a.siteKey,
      owner: a.owner || '',
      staff: a.staff || '',
      bind_proxy: a.bind_proxy,
      status: a.status,
      restrict_kind: a.restrict_kind || null,
    }));
}

async function fetchStandbyAccounts(site = 'all') {
  const siteParams = site !== 'all' ? { site } : {};
  const bust = { _ts: Date.now() };
  try {
    const { data } = await api.get('/tickets/standby-accounts', {
      params: { ...siteParams, ...bust },
    });
    if (Array.isArray(data?.data)) return data.data;
  } catch {
    /* primary endpoint unavailable — try accounts pool */
  }
  try {
    const { data } = await api.get('/accounts', {
      params: { limit: 500, ...siteParams, ...bust },
    });
    return mapStandbyRows(data?.data, site).filter((a) => (
      (a.status === 'AVAILABLE' || a.status === 'LOGGED_OUT') && !a.restrict_kind
    ));
  } catch {
    return [];
  }
}

export function useTickets(site = 'all', options = {}) {
  const { profile } = useAuth();
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['tickets', site, profile?.id || 'anon'],
    queryFn: async () => {
      const { data } = await api.get('/tickets', {
        params: site !== 'all' ? { site } : {},
      });
      return data?.data || [];
    },
    enabled,
    staleTime: 8_000,
    refetchInterval: enabled ? 10_000 : false,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useTicketStats(site = 'all', dateRange = null) {
  return useQuery({
    queryKey: ['tickets', 'stats', site, dateRange?.fromInput, dateRange?.toInput],
    queryFn: async () => {
      const { data } = await api.get('/tickets/stats', {
        params: {
          ...(site !== 'all' ? { site } : {}),
          ...dateQueryParams(dateRange),
        },
      });
      return data;
    },
    staleTime: 30_000,
  });
}

export function useStandbyForTickets(site = 'all') {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['tickets', 'standby-accounts', site, profile?.id || 'anon'],
    queryFn: () => fetchStandbyAccounts(site),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useTicketMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['tickets', 'standby-accounts'] });
    qc.invalidateQueries({ queryKey: ['ip-gate'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  const create = useMutation({
    mutationFn: (body) => api.post('/tickets', body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const goLive = useMutation({
    mutationFn: (id) => api.post(`/tickets/${id}/go-live`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/tickets/${id}/reject`, { reason }).then((r) => r.data),
    onSuccess: invalidate,
  });
  const resubmit = useMutation({
    mutationFn: ({ id, ...body }) => api.post(`/tickets/${id}/resubmit`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const confirm = useMutation({
    mutationFn: (id) => api.post(`/tickets/${id}/confirm`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const reviewIp = useMutation({
    mutationFn: async ({ id, match }) => {
      const body = { match: Boolean(match) };
      try {
        return (await api.post(`/tickets/${id}/review-ip`, body)).data;
      } catch (err) {
        const msg = String(err.message || '');
        if (msg.includes('Cannot POST') || /not found/i.test(msg)) {
          return (await api.post(`/tickets/${id}/reject`, { ...body, review_only: true })).data;
        }
        throw err;
      }
    },
    onSuccess: invalidate,
  });

  return { create, goLive, reject, resubmit, confirm, reviewIp };
}
