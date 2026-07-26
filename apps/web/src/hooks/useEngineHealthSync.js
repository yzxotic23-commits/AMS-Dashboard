import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBridgeSummary } from '../lib/bridge-client';
import api from '../lib/api';
import { accountToOperatorRow } from '../lib/account-operator-meta';
import { matchAccountForEngineSlot } from '../lib/engine-slot';

const BRIDGE_POLL_MS = 20_000;

/**
 * Detect disconnect from live FeedFlow slot.connected — not Feeding audit.
 * IN_USE + offline slot → LOGGED_OUT (AMS governance status).
 */
export function useEngineHealthSync() {
  const qc = useQueryClient();
  const synced = useRef(new Set());

  const { data: bridge } = useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: getBridgeSummary,
    refetchInterval: BRIDGE_POLL_MS,
    retry: 1,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'engine-sync'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 400 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    refetchInterval: BRIDGE_POLL_MS,
  });

  useEffect(() => {
    const slots = bridge?.slots;
    if (!slots?.length || !accounts.length) return;
    if (bridge?.reachable === false) return;

    slots.forEach(async (slot) => {
      // Session still on disk / UI-online — do not treat as logout (preview may be off).
      if (slot.connected || slot.authSaved || !slot.phone) return;

      const match = matchAccountForEngineSlot(accounts, slot);
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
