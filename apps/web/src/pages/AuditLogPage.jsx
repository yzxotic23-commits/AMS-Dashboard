import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageHead from '../components/PageHead';
import api from '../lib/api';

const ACTION_LABEL = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  STATE_CHANGE: 'State change',
  ASSIGNMENT_CHANGE: 'Assignment',
  IP_GATE_APPROVE: 'IP gate approved',
  IP_GATE_REJECT: 'IP gate rejected',
  TICKET_CREATE: 'Ticket created',
  TICKET_UPDATE: 'Ticket updated',
  FEEDING_START: 'Feeding started',
  FEEDING_STOP: 'Feeding stopped',
  LOGIN: 'Login',
  LOGOUT: 'Logout',
};

const ENTITY_LABEL = {
  account: 'Account',
  device: 'Device',
  sim: 'SIM',
  ip: 'IP',
  ticket: 'Ticket',
  ip_gate: 'IP Source',
  session: 'Session',
  user: 'User',
  profile: 'Profile',
};

function formatWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function actionBadge(action) {
  if (action === 'DELETE' || action === 'IP_GATE_REJECT') return 'badge-danger';
  if (action === 'CREATE' || action === 'TICKET_CREATE') return 'badge-success';
  if (action === 'STATE_CHANGE' || action === 'UPDATE') return 'badge-warn';
  return 'badge-default';
}

function describeMeta(row) {
  const m = row.metadata || row.new_value || {};
  if (m.from && m.to) return `${m.from} → ${m.to}`;
  if (m.account_name) return m.account_name;
  if (m.title) return m.title;
  if (m.ip_address) return m.ip_address;
  if (m.field) return `${m.field}: ${m.value ?? ''}`;
  if (m.last_charged) return `charged ${m.last_charged}`;
  return row.entity_id?.slice(0, 8) || '—';
}

export default function AuditLogPage() {
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const { data: apiData, isLoading } = useQuery({
    queryKey: ['audit', entityFilter, actionFilter],
    queryFn: async () => {
      const params = { limit: 50 };
      if (entityFilter) params.entity_type = entityFilter;
      if (actionFilter) params.action = actionFilter;
      const res = await api.get('/audit', { params });
      return res.data?.data || [];
    },
  });

  const rows = useMemo(() => apiData || [], [apiData]);

  const entityOptions = ['', 'account', 'device', 'sim', 'ip', 'ticket'];
  const actionOptions = ['', 'CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'TICKET_CREATE'];

  return (
    <div>
      <PageHead
        title="Audit Log"
        description="Immutable record of who changed what — account state transitions, IP updates, SIM top-ups, and ticket actions."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-semibold text-ams-ink">{rows.length}</span>
            <span>entries</span>
          </div>
        )}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: 'Entity', value: entityFilter, set: setEntityFilter, opts: entityOptions.map((v) => [v, v ? ENTITY_LABEL[v] || v : 'All entities']) },
          { label: 'Action', value: actionFilter, set: setActionFilter, opts: actionOptions.map((v) => [v, v ? ACTION_LABEL[v] || v : 'All actions']) },
        ].map((f) => (
          <div key={f.label} className="flex items-center gap-2 rounded-lg border border-ams-line bg-ams-surface px-3 py-2 text-[13px] shadow-card">
            <label className="text-ams-faint">{f.label}</label>
            <select className="bg-transparent font-semibold outline-none" value={f.value} onChange={(e) => f.set(e.target.value)}>
              {f.opts.map(([v, l]) => <option key={v || 'all'} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="data-panel card overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-ams-faint">Loading…</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="empty-cell">No audit entries match the filters.</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td className="col-mono col-muted whitespace-nowrap">
                      {formatWhen(row.created_at)}
                    </td>
                    <td>
                      <div className="font-semibold text-ams-ink">{row.profiles?.full_name || 'System'}</div>
                      <div className="mt-0.5 text-[0.6875rem] text-ams-faint">{row.profiles?.email}</div>
                    </td>
                    <td>
                      <span className={`badge ${actionBadge(row.action)}`}>
                        {ACTION_LABEL[row.action] || row.action}
                      </span>
                    </td>
                    <td className="font-medium">{ENTITY_LABEL[row.entity_type] || row.entity_type}</td>
                    <td className="col-remark max-w-xs truncate">
                      {describeMeta(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
