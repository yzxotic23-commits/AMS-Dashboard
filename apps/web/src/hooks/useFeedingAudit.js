import { useQuery } from '@tanstack/react-query';
import { getFeedingAudit } from '../lib/bridge-client';

export function useFeedingAudit(limit = 100) {
  return useQuery({
    queryKey: ['bridge', 'audit', limit],
    queryFn: async () => {
      const data = await getFeedingAudit(limit);
      return data || { entries: [] };
    },
    retry: false,
    refetchInterval: false,
    staleTime: 10_000,
  });
}
