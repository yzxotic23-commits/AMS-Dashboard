import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

/** Prepared numbers queue from live Supabase SIMs (unassigned). */
export function usePreparedQueue(site = 'all') {
  return useQuery({
    queryKey: ['registrations', 'prepared', site],
    queryFn: async () => {
      const res = await api.get('/registrations/prepared', {
        params: site !== 'all' ? { site } : {},
      });
      return res.data?.data || { my: [], pp: [] };
    },
    staleTime: 15_000,
  });
}

export async function dismissPreparedRow(id, { need = false } = {}) {
  await api.patch(`/registrations/prepared/${id}`, { need });
}

export async function addPreparedNumber(body) {
  const res = await api.post('/registrations/prepared', body);
  return res.data;
}

export async function deletePreparedNumber(id) {
  const res = await api.delete(`/registrations/prepared/${id}`);
  return res.data;
}

export function countRegNeededFromQueue(queue, site = 'all') {
  const rows = site === 'all'
    ? [...(queue.my || []), ...(queue.pp || [])]
    : (queue[site] || []);
  return rows.filter((r) => r.need).length;
}
