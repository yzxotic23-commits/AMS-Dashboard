import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useFeedingAudit(limit = 100) {
  return useQuery({
    queryKey: ['bridge', 'audit', limit],
    queryFn: async () => {
      const { data } = await api.get('/bridge/audit', { params: { limit } });
      return data;
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
