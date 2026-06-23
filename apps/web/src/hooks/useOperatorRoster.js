import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function operatorDisplayName(row) {
  return String(row?.full_name || row?.username || '').trim();
}

export function useOperatorRoster() {
  return useQuery({
    queryKey: ['users', 'operators'],
    queryFn: async () => {
      const { data } = await api.get('/operators');
      return data?.data || [];
    },
    staleTime: 60_000,
    retry: 2,
  });
}
