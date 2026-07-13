import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '../lib/api';

export function useRegistrationStats(siteKey = 'all') {
  return useQuery({
    queryKey: ['registrations', 'stats', siteKey],
    queryFn: async () => {
      const { data } = await api.get('/registrations/stats', {
        params: siteKey !== 'all' ? { site: siteKey } : {},
      });
      return data;
    },
    staleTime: 30_000,
  });
}

export function useRegistrationLog(page = 1, limit = 15, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['registrations', 'log', page, limit],
    queryFn: async () => {
      const { data } = await api.get('/registrations', { params: { page, limit } });
      return {
        rows: data?.data || [],
        total: data?.pagination?.total ?? 0,
      };
    },
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}
