import { useQuery } from '@tanstack/react-query';
import { getFeedingAudit } from '../lib/bridge-client';

/** limit <= 0 → fetch full feeding audit (no page cap). */
export function useFeedingAudit(limit = 0) {
  return useQuery({
    queryKey: ['bridge', 'audit', limit <= 0 ? 'all' : limit],
    queryFn: async () => {
      const data = await getFeedingAudit(limit);
      return data || { entries: [] };
    },
    retry: false,
    refetchInterval: false,
    staleTime: 10_000,
  });
}
