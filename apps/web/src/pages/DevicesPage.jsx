import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import Drawer from '../components/Drawer';
import api from '../lib/api';
import { deviceShelf } from '../lib/device-location';
import { statusMeta } from '../lib/account-status-labels';
import { accountToOperatorRow } from '../lib/account-operator-meta';

const STATUS_BADGE = {
  ACTIVE: 'badge-success',
  INACTIVE: 'badge-default',
  MAINTENANCE: 'badge-warn',
  RETIRED: 'badge-danger',
};

export default function DevicesPage() {
  const [historyDevice, setHistoryDevice] = useState(null);

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await api.get('/devices', { params: { limit: 100 } });
      return res.data?.data || [];
    },
  });

  const { data: accountsRaw = [] } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 500 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
  });

  const rows = useMemo(() => {
    const bannedByDevice = accountsRaw
      .filter((a) => a.status === 'BANNED')
      .reduce((acc, a) => {
        if (a.device_id) acc[a.device_id] = (acc[a.device_id] || 0) + 1;
        return acc;
      }, {});

    return devices.map((d) => {
      const bound = accountsRaw.filter((a) => a.device_id === d.id && a.status !== 'RECYCLED');
      const active = bound.find((a) => !['BANNED', 'RECYCLED'].includes(a.status));
      return {
        ...d,
        shelf: deviceShelf(d),
        boundAccount: active?.account_name || bound[0]?.account_name || '—',
        accountCount: bound.length,
        banCount: bannedByDevice[d.id] || 0,
        history: bound,
      };
    });
  }, [devices, accountsRaw]);

  const historyRow = historyDevice
    ? rows.find((r) => r.id === historyDevice.id)
    : null;

  return (
    <div>
      <PageHead
        title="Devices"
        description="Physical device inventory — shelf location, bound account, and ban history per unit."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-ink">{rows.length}</span>
            <span>devices</span>
          </div>
        )}
      />

      <div className="data-panel card overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-ams-faint">Loading…</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device ID</th>
                  <th>Location</th>
                  <th>Bound Account</th>
                  <th>Accounts</th>
                  <th>Bans</th>
                  <th>Brand</th>
                  <th>Serial</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="empty-cell">No devices recorded.</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td className="col-mono font-semibold">
                      <button
                        type="button"
                        className="text-ams-blue hover:underline"
                        onClick={() => setHistoryDevice(row)}
                      >
                        {row.device_name}
                      </button>
                    </td>
                    <td className="text-[13px]">{row.shelf}</td>
                    <td className="font-semibold text-ams-blue">{row.boundAccount}</td>
                    <td className="col-center">{row.accountCount}</td>
                    <td className={`col-center ${row.banCount >= 3 ? 'text-ams-warn font-semibold' : ''}`}>
                      {row.banCount}
                    </td>
                    <td>{row.brand || <span className="col-muted">—</span>}</td>
                    <td className="col-mono col-muted">{row.serial_number || '—'}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[row.status] || 'badge-default'}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer
        open={!!historyRow}
        title="Device Account History"
        onClose={() => setHistoryDevice(null)}
        footer={(
          <button type="button" className="btn btn-ghost flex-1" onClick={() => setHistoryDevice(null)}>
            Close
          </button>
        )}
      >
        {historyRow && (
          <div className="space-y-4">
            <div className="drawer-locked">
              <div className="drawer-locked-label">Device · Location</div>
              <div className="font-mono text-sm font-semibold">{historyRow.device_name}</div>
              <div className="mt-1 text-xs text-ams-faint">{historyRow.shelf}</div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-ams-muted">Accounts on this device</div>
              {historyRow.history.length === 0 ? (
                <p className="text-sm text-ams-muted">No accounts bound.</p>
              ) : (
                <ul className="space-y-2">
                  {historyRow.history.map((a) => (
                    <li key={a.id} className="flex items-center justify-between rounded-lg border border-ams-line px-3 py-2 text-[13px]">
                      <span className="font-semibold">{a.account_name}</span>
                      <span className={`badge ${statusMeta(a.status).pill}`}>
                        {statusMeta(a.status).label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-ams-faint">
              {historyRow.banCount} ban(s) recorded on this device
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
