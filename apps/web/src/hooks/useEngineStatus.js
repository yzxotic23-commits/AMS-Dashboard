import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useEngineStatus() {
  return useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: async () => {
      const { data } = await api.get('/bridge/summary');
      return data;
    },
    refetchInterval: (query) => {
      const boot = query.state.data?.boot;
      const reachable = query.state.data?.reachable;
      if (boot?.state === 'starting' || (!reachable && boot?.autoStart)) return 2_000;
      return 10_000;
    },
    staleTime: 5_000,
  });
}
