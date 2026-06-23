import { useQuery } from '@tanstack/react-query';
import { getBridgeSummary } from '../lib/bridge-client';

export function useEngineStatus() {
  return useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: getBridgeSummary,
    refetchInterval: (query) => {
      const boot = query.state.data?.boot;
      const reachable = query.state.data?.reachable;
      if (boot?.state === 'starting' || (!reachable && boot?.autoStart)) return 2_000;
      return 10_000;
    },
    staleTime: 5_000,
  });
}
