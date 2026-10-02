import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { apiDateParams } from '../lib/governanceDateRange';

function dateQueryParams(dateRange) {
  if (!dateRange?.from || !dateRange?.to) return {};
  return apiDateParams(dateRange.from, dateRange.to);
}

export function useBanStats(siteKey = 'all', dateRange = null) {
  return useQuery({
    queryKey: ['bans', 'stats', siteKey, dateRange?.fromInput, dateRange?.toInput],
    queryFn: async () => {
      const { data } = await api.get('/bans/stats', {
        params: {
          ...(siteKey !== 'all' ? { site: siteKey } : {}),
          ...dateQueryParams(dateRange),
        },
      });
      return data;
    },
    staleTime: 30_000,
  });
}

export function useSimAnomalyStats(siteKey = 'all', dateRange = null) {
  return useQuery({
    queryKey: ['bans', 'sim-anomalies', siteKey, dateRange?.fromInput, dateRange?.toInput],
    queryFn: async () => {
      const { data } = await api.get('/bans/sim-anomalies', {
        params: {
          ...(siteKey !== 'all' ? { site: siteKey } : {}),
          ...dateQueryParams(dateRange),
        },
      });
      return data;
    },
    staleTime: 30_000,
  });
}

export function useBanLog(siteKey = 'all', limit = 20) {
  return useQuery({
    queryKey: ['bans', 'log', siteKey, limit],
    queryFn: async () => {
      const { data } = await api.get('/bans', {
        params: {
          limit,
          ...(siteKey !== 'all' ? { site: siteKey } : {}),
        },
      });
      return data?.data || [];
    },
    staleTime: 30_000,
  });
}
