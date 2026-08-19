import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBridgeSummary } from '../lib/bridge-client';
import api from '../lib/api';
import { useAllAccounts } from './useOperatorAccounts';
import { matchAccountForEngineSlot } from '../lib/engine-slot';

const BRIDGE_POLL_MS = 20_000;
/** Require two consecutive offline polls before auto-logout (~40s) to avoid reconnect flaps. */
const OFFLINE_STRIKES = 2;

/**
 * Detect disconnect from live FeedFlow slot.connected — not Feeding audit.
 * IN_USE + offline slot (not connected) → LOGGED_OUT + disconnect_report for R&M bell.
 * authSaved alone no longer blocks detection (stale session after phone logout/restrict).
 */
export function useEngineHealthSync() {
  const qc = useQueryClient();
  const synced = useRef(new Set());
  const offlineStrikes = useRef(new Map());

  const { data: bridge } = useQuery({
    queryKey: ['bridge', 'summary'],
    queryFn: getBridgeSummary,
    refetchInterval: BRIDGE_POLL_MS,
    retry: 1,
  });

  const { data: accounts = [] } = useAllAccounts();

  useEffect(() => {
    const slots = bridge?.slots;
    if (!slots?.length || !accounts.length) return;
    if (bridge?.reachable === false) return;

    const seenKeys = new Set();

    slots.forEach(async (slot) => {
      if (!slot.phone) return;

      const match = matchAccountForEngineSlot(accounts, slot);
      if (!match || (match.status !== 'IN_USE' && match.status !== 'NURTURING')) return;

      const strikeKey = `offline-${match.id}-${slot.slot}`;
      seenKeys.add(strikeKey);

      // Still live on engine — clear strike counter.
      if (slot.connected) {
        offlineStrikes.current.delete(strikeKey);
        return;
      }

      const strikes = (offlineStrikes.current.get(strikeKey) || 0) + 1;
      offlineStrikes.current.set(strikeKey, strikes);
      if (strikes < OFFLINE_STRIKES) return;

      const key = `logout-${match.id}-${slot.slot}`;
      if (synced.current.has(key)) return;
      synced.current.add(key);

      try {
        await api.post(`/accounts/${match.id}/engine-disconnect`, {
          slot: Number(slot.slot),
          note: `Auto-detected by AMS: FeedFlow slot ${Number(slot.slot) + 1} offline / logged out`,
        });
        qc.invalidateQueries({ queryKey: ['accounts'] });
      } catch {
        synced.current.delete(key);
      }
    });

    // Drop strike keys for slots no longer relevant.
    for (const key of offlineStrikes.current.keys()) {
      if (!seenKeys.has(key)) offlineStrikes.current.delete(key);
    }
  }, [bridge, accounts, qc]);
}
