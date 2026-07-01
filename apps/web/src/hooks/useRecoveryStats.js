import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { apiDateParams } from '../lib/governanceDateRange';

function dateQueryParams(dateRange) {
  if (!dateRange?.from || !dateRange?.to) return {};
  return apiDateParams(dateRange.from, dateRange.to);
}

export function useRecoveryStats(siteKey = 'all', dateRange = null) {
  return useQuery({
    queryKey: ['recovery', 'stats', siteKey, dateRange?.fromInput, dateRange?.toInput],
    queryFn: async () => {
      const { data } = await api.get('/recovery/stats', {
        params: {
          ...(siteKey !== 'all' ? { site: siteKey } : {}),
          ...dateQueryParams(dateRange),
        },
      });
      return data;
    },
    staleTime: 30_000,
  });
}
