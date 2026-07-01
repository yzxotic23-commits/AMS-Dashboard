import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { apiDateParams } from '../lib/governanceDateRange';

const SUPPLY_LABELS = {
  REGISTERING: 'Registering',
  NURTURING: 'Nurturing Pool',
  AVAILABLE: 'Warmed Accounts',
  IN_USE: 'In Business Use',
};

function dateQueryParams(dateRange) {
  if (!dateRange?.from || !dateRange?.to) return {};
  return apiDateParams(dateRange.from, dateRange.to);
}

/** Live supply counts from /supply API. */
export function useSupplyStats(siteKey = 'all', dateRange = null) {
  return useQuery({
    queryKey: ['supply', 'stats', siteKey, dateRange?.fromInput, dateRange?.toInput],
    queryFn: async () => {
      const { data } = await api.get('/supply', {
        params: {
          ...(siteKey !== 'all' ? { site: siteKey } : {}),
          ...dateQueryParams(dateRange),
        },
      });
      return {
        pools: (data?.pools || []).map((p) => ({
          status: p.status,
          name: SUPPLY_LABELS[p.status] || p.name,
          cur: p.current,
          countOnly: p.count_only === true,
          healthy: p.count_only ? null : p.target,
          pct: p.count_only ? null : p.pct,
          onTarget: p.count_only ? null : p.healthy,
          isSnapshot: p.status === 'AVAILABLE' || p.status === 'IN_USE',
        })),
        isLiveSnapshot: data?.is_live_snapshot !== false,
        snapshotNote: data?.snapshot_note || '',
      };
    },
    staleTime: 30_000,
  });
}
