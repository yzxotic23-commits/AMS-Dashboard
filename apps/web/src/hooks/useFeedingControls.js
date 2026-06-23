import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useFeedingControls() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bridge', 'summary'] });
  };

  const start = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/bridge/feeding/start');
      if (data?.ok === false) {
        throw new Error(data.error || 'Failed to start feeding');
      }
      return data;
    },
    onSuccess: invalidate,
  });

  const stop = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/bridge/feeding/stop');
      if (data?.ok === false) {
        throw new Error(data.error || 'Failed to stop feeding');
      }
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    startFeeding: start.mutateAsync,
    stopFeeding: stop.mutateAsync,
    isStarting: start.isPending,
    isStopping: stop.isPending,
    isBusy: start.isPending || stop.isPending,
  };
}
