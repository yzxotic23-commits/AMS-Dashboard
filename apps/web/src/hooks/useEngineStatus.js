import { useQuery } from '@tanstack/react-query';
import { getBridgeSummary } from '../lib/bridge-client';

export function useEngineStatus() {
  return useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: getBridgeSummary,
    // Keep Offline badge / slot bubbles fresh without writing Feeding audit.
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
}
