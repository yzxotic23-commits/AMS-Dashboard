import { useQuery } from '@tanstack/react-query';
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

export function useRegistrationLog(limit = 20) {
  return useQuery({
    queryKey: ['registrations', 'log', limit],
    queryFn: async () => {
      const { data } = await api.get('/registrations', { params: { limit } });
      return data?.data || [];
    },
    staleTime: 15_000,
  });
}
