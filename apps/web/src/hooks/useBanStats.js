import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useBanStats(siteKey = 'all') {
  return useQuery({
    queryKey: ['bans', 'stats', siteKey],
    queryFn: async () => {
      const { data } = await api.get('/bans/stats', {
        params: siteKey !== 'all' ? { site: siteKey } : {},
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
