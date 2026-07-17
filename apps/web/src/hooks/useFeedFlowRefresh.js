import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { feedflowSlotLabelBody } from '../lib/feeding-audit';
import { accountHoldsEngineSlot } from '../lib/engine-slot';
import { clearSlotDisplayLabel, refreshBridgeState } from '../lib/bridge-client';
import api from '../lib/api';

/** Pull latest engine status + audit; sync labels only for active slot holders. */
export function useFeedFlowRefresh() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const accounts = qc.getQueryData(['accounts', 'all']) || [];
      const active = accounts.filter((a) => accountHoldsEngineSlot(a) && a.account_name);
      const stale = accounts.filter((a) => a.wsaf_slot != null && !accountHoldsEngineSlot(a));

      // Free sticky standby/banned slots in AMS + clear FeedFlow display names.
      await Promise.all(stale.map(async (a) => {
        const slot = a.wsaf_slot;
        await api.patch(`/accounts/${a.id}`, { wsaf_slot: null }).catch(() => {});
        await clearSlotDisplayLabel(slot).catch(() => {});
      }));

      const labelSync = active.map((a) => api.post(
        `/bridge/slots/${a.wsaf_slot}/display-label`,
        feedflowSlotLabelBody(a),
      ).catch(() => {}));

      await Promise.all([
        refreshBridgeState(),
        ...labelSync,
      ]);

      await Promise.all([
        qc.invalidateQueries({ queryKey: ['accounts'] }),
        qc.invalidateQueries({ queryKey: ['bridge'] }),
        qc.refetchQueries({ queryKey: ['bridge', 'summary'] }),
        qc.refetchQueries({ queryKey: ['bridge', 'audit'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qc]);

  return { refresh, refreshing };
}
