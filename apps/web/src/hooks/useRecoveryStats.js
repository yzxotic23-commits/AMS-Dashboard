import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useRecoveryStats(siteKey = 'all') {
  return useQuery({
    queryKey: ['recovery', 'stats', siteKey],
    queryFn: async () => {
      const { data } = await api.get('/recovery/stats', {
        params: siteKey !== 'all' ? { site: siteKey } : {},
      });
      return data;
    },
    staleTime: 30_000,
  });
}
