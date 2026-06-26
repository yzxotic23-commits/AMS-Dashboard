import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

/** RM Operation Logic v3.2 — daily registration need from ban rate & yield. */
export function useRmSupplyModel(siteKey = 'all') {
  return useQuery({
    queryKey: ['supply', 'rm-model', siteKey],
    queryFn: async () => {
      const { data } = await api.get('/supply/rm-model', {
        params: siteKey !== 'all' ? { site: siteKey } : {},
      });
      return data;
    },
    staleTime: 30_000,
  });
}
