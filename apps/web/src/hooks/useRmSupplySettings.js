import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { normalizeRmSupplySettings } from '../lib/rm-supply-config';

export function useRmSupplySettings() {
  return useQuery({
    queryKey: ['supply', 'rm-settings'],
    queryFn: async () => {
      const { data } = await api.get('/supply/rm-settings');
      return {
        config: normalizeRmSupplySettings(data?.config),
        model: data?.model,
      };
    },
  });
}

export function useRmSupplySettingsMutations() {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['supply', 'rm-settings'] });
    qc.invalidateQueries({ queryKey: ['supply', 'rm-model'] });
    qc.invalidateQueries({ queryKey: ['supply'] });
  };

  const save = useMutation({
    mutationFn: async (body) => {
      const { data } = await api.patch('/supply/rm-settings', body);
      return data;
    },
    onSuccess: invalidate,
  });

  const reset = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/supply/rm-settings/reset');
      return data;
    },
    onSuccess: invalidate,
  });

  return { save, reset };
}
