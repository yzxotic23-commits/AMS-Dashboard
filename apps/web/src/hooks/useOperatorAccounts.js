import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import {
  accountToOperatorRow,
  buildMetaPatch,
} from '../lib/account-operator-meta';
import { useAuth } from '../context/AuthContext';
import { profileStaffScope, accountInStaffScope } from '../lib/account-staff';

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
  const { profile } = useAuth();
  const { enabled = true, refetchInterval } = options;
  return useQuery({
    queryKey: ['accounts', 'all', profile?.id || 'anon'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 500 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    enabled,
    staleTime: 30_000,
    refetchInterval,
    placeholderData: (prev) => prev,
  });
}

export function useReturnedStandbyNotices(enabled = true) {
  const { profile } = useAuth();
  const canSee = profile?.role === 'business';
  const staffScope = useMemo(() => profileStaffScope(profile), [profile]);
  const { data: accounts = [] } = useAllAccounts({
    enabled: enabled && canSee,
    refetchInterval: enabled && canSee ? 15_000 : false,
  });
  return useMemo(() => {
    if (!canSee) return [];
    return accounts
      .filter((a) => a.business_notice?.type === 'returned_standby')
      .filter((a) => accountInStaffScope(a, staffScope))
      .sort((a, b) => {
        const ta = new Date(a.business_notice?.at || 0).getTime();
        const tb = new Date(b.business_notice?.at || 0).getTime();
        return tb - ta;
      });
  }, [accounts, canSee, staffScope]);
}

export function useAccountDetail(id) {
  return useQuery({
    queryKey: ['accounts', 'detail', id],
    queryFn: async () => {
      const res = await api.get(`/accounts/${id}`);
      return {
        ...accountToOperatorRow(res.data),
        statusHistory: res.data.statusHistory || [],
        deliveryTickets: res.data.deliveryTickets || [],
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
        notes: extra.notes ?? buildMetaPatch(row, patch),
      };
      const requestedIp = extra.ip_id !== undefined ? extra.ip_id : patch.ip_id;
      if (requestedIp) body.ip_id = requestedIp;
      else delete body.ip_id;
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

  const returnStandby = useMutation({
    mutationFn: async ({ id, reason }) => {
      const res = await api.post(`/accounts/${id}/return-standby`, { reason });
      return accountToOperatorRow(res.data);
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  const ackNotice = useMutation({
    mutationFn: async ({ id }) => {
      const res = await api.post(`/accounts/${id}/ack-notice`);
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
    returnStandby,
    ackNotice,
    logRegistration,
    invalidate,
  };
}
