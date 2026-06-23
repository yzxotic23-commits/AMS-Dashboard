import { useQuery } from '@tanstack/react-query';
import { wsafBridgeBase } from '../lib/wsafEmbed';

async function probeUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return { live: true, version: data.version || null };
}

/** Real engine check — bypasses demo API mock. */
export function useWsafLiveProbe() {
  return useQuery({
    queryKey: ['wsaf', 'live-probe'],
    queryFn: async () => {
      try {
        return await probeUrl(`${wsafBridgeBase()}/api/health`);
      } catch {
        return { live: false, version: null };
      }
    },
    refetchInterval: (q) => (q.state.data?.live ? 15_000 : 3_000),
    staleTime: 2_000,
  });
}
