import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { accountToOperatorRow } from '../lib/account-operator-meta';

/** Sync account status from FeedFlow bridge slot health (Stage B #8). */
export function useEngineHealthSync() {
  const qc = useQueryClient();
  const synced = useRef(new Set());

  const { data: bridge } = useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: async () => {
      const { data } = await api.get('/bridge/summary');
      return data;
    },
    refetchInterval: 20_000,
    retry: 1,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'engine-sync'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 400 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const slots = bridge?.slots;
    if (!slots?.length || !accounts.length) return;

    slots.forEach(async (slot) => {
      if (slot.connected || !slot.phone) return;

      const phone = String(slot.phone).replace(/\D/g, '');
      const match = accounts.find((a) => {
        if (a.wsaf_slot !== slot.slot && a.wsaf_slot != null) return false;
        const acctPhone = String(a.phone_number || '').replace(/\D/g, '');
        return acctPhone && phone && acctPhone.endsWith(phone.slice(-9));
      });
      if (!match || match.status !== 'IN_USE') return;

      const key = `logout-${match.id}-${slot.slot}`;
      if (synced.current.has(key)) return;
      synced.current.add(key);

      try {
        await api.post(`/accounts/${match.id}/transition`, {
          to_status: 'LOGGED_OUT',
          reason: 'Engine reported slot offline / logged out',
        });
        qc.invalidateQueries({ queryKey: ['accounts'] });
      } catch {
        synced.current.delete(key);
      }
    });
  }, [bridge, accounts, qc]);
}
