import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { feedflowSlotLabelBody } from '../lib/feeding-audit';
import api from '../lib/api';

/** Pull latest engine status + audit and re-push AMS account labels to slots. */
export function useFeedFlowRefresh() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const accounts = qc.getQueryData(['accounts', 'all']) || [];
      const labelSync = accounts
        .filter((a) => a.wsaf_slot != null && a.account_name)
        .map((a) => api.post(
          `/bridge/slots/${a.wsaf_slot}/display-label`,
          feedflowSlotLabelBody(a),
        ).catch(() => {}));

      await Promise.all([
        api.post('/bridge/refresh').catch(() => api.get('/bridge/summary')),
        api.post('/bridge/audit/sync').catch(() => {}),
        ...labelSync,
      ]);

      await Promise.all([
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
