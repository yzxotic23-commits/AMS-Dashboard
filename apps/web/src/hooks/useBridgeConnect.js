import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  connectBridgeSlot,
  disconnectBridgeSlot as disconnectSlot,
  getBridgeStatus,
  startBridgeEngine,
} from '../lib/bridge-client';

export function useEngineBridgeStatus() {
  return useQuery({
    queryKey: ['bridge', 'status'],
    queryFn: getBridgeStatus,
    refetchInterval: false,
    staleTime: 4_000,
  });
}

export { startBridgeEngine };

export function useBridgeConnect() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const connect = useCallback(async (slot, body) => {
    setLoading(true);
    setError(null);
    try {
      return await connectBridgeSlot(slot, body);
    } catch (e) {
      const msg = e.message || 'Connect failed';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const startEngine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      return await startBridgeEngine();
    } catch (e) {
      const msg = e.message || 'Engine start failed';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async (slot) => {
    setLoading(true);
    setError(null);
    try {
      return await disconnectSlot(slot);
    } catch (e) {
      const msg = e.message || 'Disconnect failed';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { connect, disconnect, startEngine, loading, error };
}
