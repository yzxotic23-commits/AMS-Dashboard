import { useQuery } from '@tanstack/react-query';
import { getBridgeSummary } from '../lib/bridge-client';

export function useEngineStatus() {
  return useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: getBridgeSummary,
    refetchInterval: false,
    staleTime: 5_000,
  });
}
