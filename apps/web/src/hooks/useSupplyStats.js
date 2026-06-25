import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

const SUPPLY_LABELS = {
  REGISTERING: 'Registering',
  NURTURING: 'Nurturing Pool',
  AVAILABLE: 'Standby Pool',
  IN_USE: 'In Business Use',
};

/** Live supply counts from /supply API. */
export function useSupplyStats(siteKey = 'all') {
  return useQuery({
    queryKey: ['supply', 'stats', siteKey],
    queryFn: async () => {
      const { data } = await api.get('/supply', {
        params: siteKey !== 'all' ? { site: siteKey } : {},
      });
      return (data?.pools || []).map((p) => ({
        status: p.status,
        name: p.name || SUPPLY_LABELS[p.status],
        cur: p.current,
        countOnly: p.count_only === true,
        healthy: p.count_only ? null : p.target,
        pct: p.count_only ? null : p.pct,
        onTarget: p.count_only ? null : p.healthy,
      }));
    },
    staleTime: 30_000,
  });
}
