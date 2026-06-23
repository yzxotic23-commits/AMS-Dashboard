import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import {
  filterDevicesBySite,
  filterIpsBySite,
  filterSimsBySite,
  mapIpRow,
  simOptionFromRow,
} from '../lib/resource-mappers';
import { compareDeviceNames } from '../lib/device-location';

/** Same IP ledger as Resources → IP page (active rows, site-scoped). */
export function useFreeIps(siteKey) {
  const { data } = useQuery({
    queryKey: ['ips'],
    queryFn: async () => {
      const res = await api.get('/ips', { params: { limit: 200 } });
      return (res.data?.data || []).map(mapIpRow);
    },
  });

  return useMemo(() => {
    const active = (data || []).filter((ip) => ip.active);
    return filterIpsBySite(active, siteKey);
  }, [data, siteKey]);
}

/** Same device inventory as Resources → Devices page. */
export function useDeviceOptions(siteKey) {
  const { data } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await api.get('/devices', { params: { limit: 200 } });
      return res.data?.data || [];
    },
  });

  return useMemo(() => {
    const rows = (data || [])
      .map((d) => ({
        id: d.id,
        device_name: d.device_name,
        status: d.status,
        notes: d.notes || '',
      }))
      .filter((d) => d.device_name);
    return filterDevicesBySite(rows, siteKey).sort(compareDeviceNames);
  }, [data, siteKey]);
}

/** Same SIM ledger as Resources → SIM page. */
export function useSimOptions(siteKey) {
  const { data } = useQuery({
    queryKey: ['sims'],
    queryFn: async () => {
      const res = await api.get('/sims', { params: { limit: 200 } });
      return res.data?.data || [];
    },
  });

  return useMemo(() => {
    const rows = (data || []).map(simOptionFromRow);
    return filterSimsBySite(rows, siteKey);
  }, [data, siteKey]);
}
