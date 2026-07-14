import { useMemo } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useSite } from '../context/SiteContext';
import { useFeedingAudit } from '../hooks/useFeedingAudit';
import { useAllAccounts } from '../hooks/useOperatorAccounts';
import {
  computeFeedingAuditSummary,
  enrichFeedingAuditLocations,
  filterFeedingAuditBySite,
} from '../lib/feeding-audit';
import { SITES } from '../lib/sites';
import { wsafBridgeBase } from '../lib/wsafEmbed';

const STATUS_CLASS = {
  Active: 'badge-accent',
  Success: 'badge-success',
  Restrict: 'badge-warn',
  Banned: 'badge-danger',
};

const TONE_CLASS = {
  ok: 'metric-ok',
  warn: 'metric-warn',
  bad: 'metric-bad',
};

function SummaryTile({ label, value, sub, tone = 'default' }) {
  const toneClass = TONE_CLASS[tone] || '';

  return (
    <div className={`metric-card${toneClass ? ` ${toneClass}` : ''}`}>
      <div className="text-xs font-medium text-ams-muted">{label}</div>
      <div className="metric-val">{value}</div>
      {sub && <div className="text-[11px] text-ams-faint">{sub}</div>}
    </div>
  );
}

export default function FeedingAuditPanel() {
  const { site } = useSite();
  const { data, isLoading, isFetching, refetch, isError } = useFeedingAudit(100);
  const { data: accounts = [] } = useAllAccounts();

  const allEntries = useMemo(
    () => enrichFeedingAuditLocations(data?.entries || [], accounts),
    [data?.entries, accounts],
  );
  const entries = useMemo(
    () => filterFeedingAuditBySite(allEntries, site),
    [allEntries, site],
  );
  const summary = useMemo(() => computeFeedingAuditSummary(entries), [entries]);
  const siteLabel = SITES[site]?.name || 'All sites';

  return (
    <section className="card overflow-hidden">
      <div className="engine-panel-head border-b border-ams-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ams-ink">Feeding audit log</h2>
          <p className="text-[11px] text-ams-faint">
            Per-account feeding outcomes — filtered by site switcher ({siteLabel}).
          </p>
        </div>
        <div className="engine-panel-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh log"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
          <a
            href={`${wsafBridgeBase()}/api/audit/export`}
            className="btn btn-secondary btn-sm"
            download
          >
            <Download size={14} />
            Export CSV
          </a>
        </div>
      </div>

      {!isLoading && !isError && (
        <div className="grid grid-cols-2 gap-3 border-b border-ams-line p-5 lg:grid-cols-4">
          <SummaryTile
            label="Total volume"
            value={summary.totalFeedingVolume}
            sub={`${entries.length} entries · ${siteLabel}`}
          />
          <SummaryTile
            label="Success"
            value={`${summary.successRate}%`}
            sub={`${summary.successVolume} accounts`}
            tone="ok"
          />
          <SummaryTile
            label="Restrict"
            value={`${summary.restrictRate}%`}
            sub={`${summary.restrictVolume} accounts`}
            tone="warn"
          />
          <SummaryTile
            label="Banned"
            value={`${summary.bannedRate}%`}
            sub={`${summary.bannedVolume} accounts · ${summary.uniqueIpsWithBan} IPs`}
            tone="bad"
          />
        </div>
      )}

      {isLoading ? (
        <p className="p-8 text-center text-sm text-ams-faint">Loading feeding audit…</p>
      ) : isError ? (
        <p className="p-8 text-center text-sm text-ams-faint">
          Engine offline — audit log unavailable until FeedFlow is running.
        </p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Account</th>
                <th>Location</th>
                <th>Day</th>
                <th>Status</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    {site === 'all'
                      ? 'No feeding events yet.'
                      : `No feeding events for ${siteLabel}.`}
                  </td>
                </tr>
              ) : entries.map((row) => (
                <tr key={row.id}>
                  <td className="col-mono col-muted whitespace-nowrap">{row.dateTime || row.ts}</td>
                  <td className="font-medium">{row.accountName}</td>
                  <td>{row.location || '—'}</td>
                  <td className="col-mono">{row.feedingDays || '—'}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[row.feedingStatus] || 'badge-default'}`}>
                      {row.feedingStatus}
                    </span>
                  </td>
                  <td className="col-mono col-muted">{row.ipAddress || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
