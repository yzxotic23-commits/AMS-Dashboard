import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { parseOperatorMeta } from '../lib/account-operator-meta';

const SUPPLY_TARGETS = {
  REGISTERING: 50,
  NURTURING: 240,
  AVAILABLE: 600,
  IN_USE: 512,
};

const SUPPLY_LABELS = {
  REGISTERING: 'Registering',
  NURTURING: 'Nurturing Pool',
  AVAILABLE: 'Standby Pool',
  IN_USE: 'In Business Use',
};

/** Live supply counts from accounts API (Stage A #1). */
export function useSupplyStats(siteKey = 'all') {
  return useQuery({
    queryKey: ['accounts', 'supply', siteKey],
    queryFn: async () => {
      const { data } = await api.get('/accounts', { params: { limit: 500 } });
      const rows = data?.data || [];
      const filtered = siteKey === 'all'
        ? rows
        : rows.filter((a) => parseOperatorMeta(a).site_key === siteKey);

      const counts = {
        REGISTERING: 0,
        NURTURING: 0,
        AVAILABLE: 0,
        IN_USE: 0,
      };
      filtered.forEach((a) => {
        if (counts[a.status] !== undefined) counts[a.status] += 1;
      });

      return Object.entries(SUPPLY_LABELS).map(([status, name]) => ({
        name,
        cur: counts[status] || 0,
        healthy: SUPPLY_TARGETS[status],
      }));
    },
    staleTime: 30_000,
  });
}
