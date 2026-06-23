import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useEngineBridgeStatus() {
  return useQuery({
    queryKey: ['bridge', 'status'],
    queryFn: async () => {
      try {
        const { data } = await api.get('/bridge/status');
        return data;
      } catch (e) {
        return {
          ok: false,
          reachable: false,
          accounts: [],
          error: e.message || 'Engine offline',
        };
      }
    },
    refetchInterval: 8_000,
    staleTime: 4_000,
  });
}

export async function startBridgeEngine() {
  const { data } = await api.post('/bridge/engine/start');
  return data;
}

export async function disconnectBridgeSlot(slot) {
  const { data } = await api.post(`/bridge/disconnect/${slot}`);
  return data;
}

export function useBridgeConnect() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const connect = useCallback(async (slot, body) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/bridge/connect/${slot}`, body);
      return data;
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
      return await disconnectBridgeSlot(slot);
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
