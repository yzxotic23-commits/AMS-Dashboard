import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { accountToOperatorRow } from '../lib/account-operator-meta';
import { accountHoldsEngineSlot } from '../lib/engine-slot';
import { clearSlotDisplayLabel } from '../lib/bridge-client';

/**
 * Standby / logged-out / banned accounts must not keep wsaf_slot forever —
 * that blocks scan-in reuse and keeps sticky names like "tiffany" on FeedFlow.
 */
export function useReleaseStaleEngineSlots() {
  const qc = useQueryClient();
  const releasing = useRef(new Set());

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 400 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const stale = accounts.filter(
      (a) => a.wsaf_slot != null && !accountHoldsEngineSlot(a),
    );
    if (!stale.length) return;

    stale.forEach(async (row) => {
      const key = `${row.id}:${row.wsaf_slot}`;
      if (releasing.current.has(key)) return;
      releasing.current.add(key);
      const slot = row.wsaf_slot;
      try {
        await api.patch(`/accounts/${row.id}`, { wsaf_slot: null });
        await clearSlotDisplayLabel(slot).catch(() => {});
        qc.invalidateQueries({ queryKey: ['accounts'] });
        qc.invalidateQueries({ queryKey: ['bridge'] });
      } catch {
        releasing.current.delete(key);
      }
    });
  }, [accounts, qc]);
}
