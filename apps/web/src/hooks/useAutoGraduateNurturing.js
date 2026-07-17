import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { accountToOperatorRow } from '../lib/account-operator-meta';
import { isAutoGraduationDue } from '../lib/nurturing-day';

/** Auto-move nurturing accounts to standby pool on day 7 (Stage B #7). */
export function useAutoGraduateNurturing() {
  const qc = useQueryClient();
  const graduated = useRef(new Set());

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'NURTURING'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { status: 'NURTURING', limit: 200 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const due = accounts.filter(
      (a) => a.nurturing_phase === 'auto' && isAutoGraduationDue(a),
    );
    if (!due.length) return;

    due.forEach(async (row) => {
      if (graduated.current.has(row.id)) return;
      graduated.current.add(row.id);
      try {
        await api.post(`/accounts/${row.id}/transition`, {
          to_status: 'AVAILABLE',
          reason: 'Auto-graduated — nurturing day 7 complete',
        });
        if (row.wsaf_slot != null) {
          await api.patch(`/accounts/${row.id}`, { wsaf_slot: null }).catch(() => {});
        }
        qc.invalidateQueries({ queryKey: ['accounts'] });
      } catch {
        graduated.current.delete(row.id);
      }
    });
  }, [accounts, qc]);
}
