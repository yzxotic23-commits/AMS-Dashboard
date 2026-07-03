import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import {
  filterDevicesBySite,
  filterSimsBySite,
  mapIpRow,
  simOptionFromRow,
} from '../lib/resource-mappers';
import { compareDeviceNames } from '../lib/device-location';

/** Same IP ledger as Resources → IP page (all active rows — proxies are site-agnostic). */
export function useFreeIps(options = {}) {
  const { enabled = true } = options;
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['ips'],
    queryFn: async () => {
      const res = await api.get('/ips', { params: { limit: 200 } });
      return (res.data?.data || []).map(mapIpRow);
    },
    enabled,
    staleTime: 30_000,
  });

  const list = useMemo(() => (data || []).filter((ip) => ip.active), [data]);

  return { list, isLoading: isLoading || isFetching };
}

/** Same device inventory as Resources → Devices page. */
export function useDeviceOptions(siteKey, options = {}) {
  const { enabled = true } = options;
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['devices', siteKey],
    queryFn: async () => {
      let expandMessage = '';
      if (siteKey === 'my' || siteKey === 'pp') {
        try {
          const { data: expand } = await api.post('/devices/ensure-capacity', { site_key: siteKey });
          if (expand?.expanded) {
            expandMessage = expand.message || `Added devices: ${(expand.created || []).join(', ')}`;
          }
        } catch {
          // still load ledger
        }
      }
      const res = await api.get('/devices', { params: { limit: 200 } });
      return { rows: res.data?.data || [], expandMessage };
    },
    enabled,
    staleTime: 30_000,
  });

  const list = useMemo(() => {
    const rows = (data?.rows || [])
      .map((d) => ({
        id: d.id,
        device_name: d.device_name,
        status: d.status,
        notes: d.notes || '',
      }))
      .filter((d) => d.device_name);
    return filterDevicesBySite(rows, siteKey).sort(compareDeviceNames);
  }, [data, siteKey]);

  return {
    list,
    expandMessage: data?.expandMessage || '',
    isLoading: isLoading || isFetching,
  };
}

/** Same SIM ledger as Resources → SIM page. */
export function useSimOptions(siteKey, options = {}) {
  const { enabled = true } = options;
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['sims'],
    queryFn: async () => {
      const res = await api.get('/sims', { params: { limit: 200 } });
      return res.data?.data || [];
    },
    enabled,
    staleTime: 30_000,
  });

  const list = useMemo(() => {
    const rows = (data || []).map(simOptionFromRow);
    return filterSimsBySite(rows, siteKey);
  }, [data, siteKey]);

  return { list, isLoading: isLoading || isFetching };
}
