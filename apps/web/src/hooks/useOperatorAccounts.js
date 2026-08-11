import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import {
  accountToOperatorRow,
  buildMetaPatch,
} from '../lib/account-operator-meta';

export function useAccountsByStatus(status, options = {}) {
  return useQuery({
    queryKey: ['accounts', status, options.scope].filter(Boolean),
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { status, limit: 200 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    staleTime: options.staleTime ?? 30_000,
  });
}

export function useAllAccounts(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 500 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useAccountDetail(id) {
  return useQuery({
    queryKey: ['accounts', 'detail', id],
    queryFn: async () => {
      const res = await api.get(`/accounts/${id}`);
      return {
        ...accountToOperatorRow(res.data),
        statusHistory: res.data.statusHistory || [],
      };
    },
    enabled: Boolean(id),
  });
}

export function useAccountMutations() {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['ips'] });
    qc.invalidateQueries({ queryKey: ['devices'] });
    qc.invalidateQueries({ queryKey: ['bans'] });
    qc.invalidateQueries({ queryKey: ['audit'] });
  };

  const patchAccount = useMutation({
    mutationFn: async ({ id, row, patch, extra = {} }) => {
      const merged = { ...row, ...patch };
      const body = {
        ...extra,
        phone_number: merged.phone_number,
        wsaf_slot: merged.wsaf_slot,
        device_id: merged.device_id ?? null,
        sim_id: merged.sim_id ?? null,
        ip_id: merged.ip_id ?? null,
        notes: extra.notes ?? buildMetaPatch(row, patch),
      };
      const res = await api.patch(`/accounts/${id}`, body);
      return accountToOperatorRow(res.data);
    },
    onSuccess: invalidate,
  });

  const transitionAccount = useMutation({
    mutationFn: async ({ id, to_status, reason }) => {
      const res = await api.post(`/accounts/${id}/transition`, { to_status, reason });
      return accountToOperatorRow(res.data);
    },
    onSuccess: invalidate,
  });

  const createAccount = useMutation({
    mutationFn: async (body) => {
      const res = await api.post('/accounts', body);
      return accountToOperatorRow(res.data);
    },
    onSuccess: invalidate,
  });

  const banAccount = useMutation({
    mutationFn: async ({ id, stage, reason, source }) => {
      const res = await api.post(`/accounts/${id}/ban`, { stage, reason, source });
      return accountToOperatorRow(res.data);
    },
    onSuccess: invalidate,
  });

  const markStrict = useMutation({
    mutationFn: async ({ id, kind }) => {
      const res = await api.post(`/accounts/${id}/mark-strict`, { kind });
      return {
        account: accountToOperatorRow(res.data),
        strict: res.data?._strict || null,
      };
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['bridge', 'audit'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  const reportDisconnect = useMutation({
    mutationFn: async ({ id, note }) => {
      const res = await api.post(`/accounts/${id}/report-disconnect`, { note });
      return accountToOperatorRow(res.data);
    },
    onSuccess: invalidate,
  });

  const resolveDisconnect = useMutation({
    mutationFn: async ({ id, outcome, reason }) => {
      const res = await api.post(`/accounts/${id}/resolve-disconnect`, { outcome, reason });
      return accountToOperatorRow(res.data);
    },
    onSuccess: invalidate,
  });

  const logRegistration = useMutation({
    mutationFn: async (body) => {
      const res = await api.post('/registrations', body);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });

  return {
    patchAccount,
    transitionAccount,
    createAccount,
    banAccount,
    markStrict,
    reportDisconnect,
    resolveDisconnect,
    logRegistration,
    invalidate,
  };
}
