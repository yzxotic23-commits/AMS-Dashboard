import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBridgeSummary } from '../lib/bridge-client';
import api, { AUTOMATION_HEADERS } from '../lib/api';
import { useAllAccounts } from './useOperatorAccounts';
import { findEngineSlotForAccount, isLiveEngineSlot } from '../lib/engine-slot';

const BRIDGE_POLL_MS = 20_000;
/** Require two consecutive offline polls before auto-logout (~40s) to avoid reconnect flaps. */
const OFFLINE_STRIKES = 2;

/**
 * Detect a dead WhatsApp session from the live engine slot — feeding or idle.
 * Ledger status is not the source of truth. Preview sockets down during an
 * active feeding run are ignored. A hard engine logout is applied immediately.
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

    accounts.forEach(async (account) => {
      if (account.status !== 'IN_USE' && account.status !== 'NURTURING') return;

      const slot = findEngineSlotForAccount(account, slots);
      if (!slot) return;

      const strikeKey = `offline-${account.id}-${slot.slot}`;
      seenKeys.add(strikeKey);

      if (slot.linking) {
        offlineStrikes.current.delete(strikeKey);
        return;
      }

      // Feeding CLI owns the live sockets — preview connected=false is expected.
      if (slot.feedingActive && !slot.loggedOut) {
        offlineStrikes.current.delete(strikeKey);
        return;
      }

      // Preview down + leftover auth is normal on Railway (no auto-reconnect).
      // That is NOT a WhatsApp logout — do not open Pending confirmation.
      if (isLiveEngineSlot(slot) && !slot.loggedOut) {
        offlineStrikes.current.delete(strikeKey);
        return;
      }
      if (!slot.loggedOut && slot.authSaved) {
        offlineStrikes.current.delete(strikeKey);
        return;
      }

      const hardLogout = Boolean(slot.loggedOut);
      const sessionGone = !slot.authSaved && !isLiveEngineSlot(slot);
      if (!hardLogout && !sessionGone) {
        offlineStrikes.current.delete(strikeKey);
        return;
      }

      const strikes = (offlineStrikes.current.get(strikeKey) || 0) + 1;
      offlineStrikes.current.set(strikeKey, strikes);
      if (!hardLogout && strikes < OFFLINE_STRIKES) return;

      const key = `logout-${account.id}-${slot.slot}`;
      if (synced.current.has(key)) return;
      synced.current.add(key);

      try {
        await api.post(`/accounts/${account.id}/engine-disconnect`, {
          slot: Number(slot.slot),
          loggedOut: hardLogout,
          note: hardLogout
            ? `Auto-detected by AMS: FeedFlow slot ${Number(slot.slot) + 1} WhatsApp session ended`
            : `Auto-detected by AMS: FeedFlow slot ${Number(slot.slot) + 1} session removed`,
        }, { headers: AUTOMATION_HEADERS });
        qc.invalidateQueries({ queryKey: ['accounts'] });
      } catch {
        synced.current.delete(key);
      }
    });

    for (const key of offlineStrikes.current.keys()) {
      if (!seenKeys.has(key)) offlineStrikes.current.delete(key);
    }
  }, [bridge, accounts, qc]);
}
