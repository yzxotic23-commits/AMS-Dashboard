import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function usePhoneSyncRows(site = 'all') {
  return useQuery({
    queryKey: ['supply', 'phone-sync', site],
    queryFn: async () => {
      const { data } = await api.get('/supply/phone-sync', {
        params: site !== 'all' ? { site } : {},
      });
      return data;
    },
    staleTime: 30_000,
  });
}

export function usePhoneSyncMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, action, sim_id }) => {
      const { data } = await api.post(`/supply/phone-sync/${accountId}`, { action, sim_id });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supply'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sims-bound-accounts'] });
    },
  });
}
