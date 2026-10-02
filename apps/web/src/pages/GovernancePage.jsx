import PageHead from '../components/PageHead';
import KpiInfoTip from '../components/KpiInfoTip';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSite } from '../context/SiteContext';
import { useGovernanceDate } from '../context/GovernanceDateContext';
import { SITES } from '../lib/sites';
import { useBanStats, useSimAnomalyStats } from '../hooks/useBanStats';
import { useRecoveryStats } from '../hooks/useRecoveryStats';
import { useSupplyStats } from '../hooks/useSupplyStats';
import { useTicketStats } from '../hooks/useTickets';
import { BAD_IP_FLAG_THRESHOLD } from '../lib/ban-analytics';
import { kpiInfoForSupply } from '../lib/supplyKpiInfo';
import { formatRangeCompact, isRangeEndingToday } from '../lib/governanceDateRange';
import { filterSimsBySite, mapSimRow } from '../lib/resource-mappers';
import api from '../lib/api';

const BAR_TONE = {
  danger: 'bar-row-fill-danger',
  warn: 'bar-row-fill-warn',
  muted: 'bar-row-fill-muted',
};

const STAGE_GRID_COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

function supplyTone(pct) {
  if (pct >= 95) return 'metric-ok';
  if (pct >= 80) return 'metric-warn';
  return 'metric-bad';
}

function banTone(val) {
  if (val <= 8) return 'metric-ok';
  if (val <= 12) return 'metric-warn';
  return 'metric-bad';
}

function MetricCard({
  name, value, sub, pct, tone, pctLabel, info,
}) {
  const tip = info;
  return (
    <div className={`metric-card ${tone || ''}`}>
      <div className="metric-card-head text-xs font-medium text-ams-muted">
        <span>{name}</span>
        {tip && (
          <KpiInfoTip
            title={tip.title}
            body={tip.body}
            formula={tip.formula}
            align={tip.align}
          />
        )}
      </div>
      <div className="metric-val">
        {value}
        {sub && <span className="text-sm font-medium text-ams-faint"> {sub}</span>}
      </div>
      {pct != null && (
        <>
          <div className="metric-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
          {pctLabel && <div className="text-[11px] text-ams-faint">{pctLabel}</div>}
        </>
      )}
    </div>
  );
}

function SupplyCountCard({ name, value, snapshotLabel, info }) {
  const tip = info;
  return (
    <div className="metric-card">
      <div className="metric-card-head text-xs font-medium text-ams-muted">
        <span>{name}</span>
        {tip && (
          <KpiInfoTip
            title={tip.title}
            body={tip.body}
            formula={tip.formula}
            align={tip.align}
          />
        )}
      </div>
      <div className="metric-val">{value}</div>
      <div className="text-[11px] text-ams-faint">
        {snapshotLabel || 'Current count only'}
      </div>
    </div>
  );
}

function BarRow({ label, val, pct, tone = 'muted' }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-[7.5rem] shrink-0 truncate text-ams-muted" title={label}>{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-ams-surface-muted">
        <div className={`h-full rounded-full ${BAR_TONE[tone] || BAR_TONE.muted}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium text-ams-muted">{val}</span>
    </div>
  );
}

function DashSection({ title, badge, children }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 border-b border-ams-line pb-2">
        <h3 className="text-sm font-semibold text-ams-ink">{title}</h3>
        {badge && (
          <span className="rounded bg-ams-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ams-faint">
            {badge}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function KpiPanel({ title, value, hint, tone }) {
  const warn = tone === 'warn';
  const danger = tone === 'danger';
  const panelClass = warn
    ? 'dash-panel border-ams-warn/40 bg-ams-warn/5'
    : danger
      ? 'dash-panel border-ams-danger/30 bg-ams-danger/5'
      : 'dash-panel';
  const titleClass = warn
    ? 'dash-panel-title text-ams-warn'
    : danger
      ? 'dash-panel-title text-ams-danger'
      : 'dash-panel-title';
  const valueClass = warn
    ? 'text-ams-warn'
    : danger
      ? 'text-ams-danger'
      : 'text-ams-ink';
  return (
    <div className={panelClass}>
      <h4 className={titleClass}>{title}</h4>
      <div className={`text-2xl font-bold tracking-tight ${valueClass}`}>{value}</div>
      {hint ? (
        <p className="mt-1 text-[12px] leading-snug text-ams-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export default function GovernancePage() {
  const { site } = useSite();
  const dateRange = useGovernanceDate();
  const { data: banStats, isLoading: banLoading } = useBanStats(site, dateRange);
  const { data: recStats } = useRecoveryStats(site, dateRange);
  const { data: supplyData } = useSupplyStats(site, dateRange);
  const { data: tkStats } = useTicketStats(site, dateRange);
  const { data: simAnomaly, isLoading: simAnomalyLoading } = useSimAnomalyStats(site, dateRange);
  const { data: simRows = [] } = useQuery({
    queryKey: ['sims', 'governance', site],
    queryFn: async () => {
      const res = await api.get('/sims', { params: { limit: 500 } });
      return (res.data?.data || []).map(mapSimRow);
    },
    staleTime: 30_000,
  });
  const simKpis = useMemo(() => {
    const rows = filterSimsBySite(simRows, site);
    const due = rows.filter((s) => s.days_left != null && s.days_left <= 0).length;
    const expiring = rows.filter((s) => s.days_left != null && s.days_left > 0 && s.days_left <= 7).length;
    return { due, expiring };
  }, [simRows, site]);
  const supply = supplyData?.pools?.length ? supplyData.pools : [];
  const rangeLabel = formatRangeCompact(dateRange.from, dateRange.to);
  const liveEnd = isRangeEndingToday(dateRange.to);
  const snapshotSuffix = liveEnd ? '' : ` (as of ${rangeLabel.split('–').pop()?.trim() || rangeLabel})`;

  const rejReason = tkStats?.rejectReasons?.length
    ? tkStats.rejectReasons.map((r) => ({
      l: r.label,
      v: r.pct,
      tone: r.pct >= 40 ? 'danger' : r.pct >= 25 ? 'warn' : 'muted',
    }))
    : [];

  const byStage = banStats?.byStage?.length
    ? banStats.byStage.map((b) => ({
      name: b.name,
      val: b.pct,
      count: b.count ?? b.banned,
      restrict: b.restrict,
      pending: b.pending,
    }))
    : [];

  const overallBan = banStats?.overallPct != null
    ? `${banStats.overallPct}%`
    : '—';

  return (
    <div>
      <PageHead
        title="Dashboard (Governance)"
        description="Diagnostic view across supply, ban rates, and recovery."
      />

      <div className="mb-4 text-xs text-ams-faint">
        {SITES[site].name}
        {' · '}
        Range: {rangeLabel}
      </div>

      <DashSection title="Supply Levels">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {supply.length === 0 ? (
            <p className="col-span-full text-sm text-ams-muted">No account supply data yet.</p>
          ) : supply.map((s) => {
            const info = kpiInfoForSupply(s.status);
            const isSnapshot = !liveEnd && (s.status === 'AVAILABLE' || s.status === 'IN_USE');
            if (s.countOnly || isSnapshot) {
              return (
                <SupplyCountCard
                  key={s.name}
                  name={s.name}
                  value={s.cur}
                  info={info}
                  snapshotLabel={isSnapshot || (s.countOnly && !liveEnd)
                    ? `Live count${snapshotSuffix}`
                    : 'Current count only'}
                />
              );
            }
            const pct = s.pct ?? (s.healthy ? Math.round((s.cur / s.healthy) * 100) : 0);
            const isRegistering = s.status === 'REGISTERING' || s.name === 'Registering';
            return (
              <MetricCard
                key={s.name}
                name={s.name}
                value={s.cur}
                sub={`/ ${s.healthy}`}
                pct={pct}
                info={info}
                pctLabel={isRegistering
                  ? `${pct}% of RM daily reg target`
                  : s.name === 'Nurturing Pool'
                    ? `${pct}% of RM nurturing target`
                    : `${pct}% of target`}
                tone={supplyTone(pct)}
              />
            );
          })}
        </div>
      </DashSection>

      <DashSection
        title="Ban Rate · By Stage"
        badge={banLoading ? 'Loading…' : `Banned ${overallBan} · ${banStats?.total ?? 0} bans · ${banStats?.pendingBacklog ?? 0} pending`}
      >
        {(banStats?.pendingBacklog > 0) && (
          <div className="mb-3 rounded-lg border border-ams-warn/50 bg-ams-warn/10 px-4 py-3 text-[13px] text-ams-warn">
            {banStats.pendingBacklog} event{banStats.pendingBacklog === 1 ? '' : 's'} still Pending Confirmation.
            Ban-rate KPIs stay incomplete until Resource confirms Restrict / Banned / false positive.
          </div>
        )}
        {byStage.length === 0 ? (
          <div className="dash-panel">
            <div className="dash-empty-hint">
              No keep-alive logout events in this range. Ban rate counts confirmed Banned only — Restrict and pending are tracked separately.
            </div>
          </div>
        ) : (
        <div className={`grid gap-3 ${STAGE_GRID_COLS[Math.min(byStage.length, 4)] || STAGE_GRID_COLS[4]}`}>
          {byStage.map((b) => (
            <MetricCard
              key={b.name}
              name={b.name}
              value={`${b.val}%`}
              sub={b.count != null ? `(${b.count} banned)` : null}
              pct={Math.min(100, b.val * 5)}
              pctLabel={`${b.val}% ban rate · ${b.restrict ?? 0} restrict · ${b.pending ?? 0} pending`}
              tone={banTone(b.val)}
            />
          ))}
        </div>
        )}

        {banStats?.total > 0 && (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="dash-panel">
              <h4 className="dash-panel-title">By IP · Device · Method</h4>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase text-ams-faint">Top IPs</div>
                  {(banStats.byIp || []).map((r) => (
                    <BarRow key={r.label} label={r.label} val={r.count} pct={r.pct} tone={r.pct >= 30 ? 'danger' : 'warn'} />
                  ))}
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase text-ams-faint">Top Devices</div>
                  {(banStats.byDevice || []).map((r) => (
                    <BarRow key={r.label} label={r.label} val={r.count} pct={r.pct} tone="muted" />
                  ))}
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase text-ams-faint">Nurturing Method</div>
                  {(banStats.byMethod || []).map((r) => (
                    <BarRow key={r.label} label={r.label || '—'} val={r.count} pct={r.pct} tone="muted" />
                  ))}
                </div>
              </div>
            </div>
            <div className="dash-panel">
              <h4 className="dash-panel-title">Ban Causes · Number Range</h4>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase text-ams-faint">Reasons</div>
                  {(banStats.byReason || []).map((r) => (
                    <BarRow key={r.label} label={r.label} val={r.count} pct={r.pct} tone="danger" />
                  ))}
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase text-ams-faint">Number Segment</div>
                  {(banStats.bySegment || []).map((r) => (
                    <BarRow key={r.label} label={r.label} val={r.count} pct={r.pct} tone="warn" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {(banStats?.flaggedIps?.length > 0) && (
          <div className="mt-4 dash-panel border-ams-warn/30 bg-ams-warn/5">
            <h4 className="dash-panel-title text-ams-warn">
              Bad IP flags (≥{BAD_IP_FLAG_THRESHOLD} bans)
            </h4>
            <div className="flex flex-wrap gap-2">
              {banStats.flaggedIps.map((ip) => (
                <span key={ip.id} className="rounded-md border border-ams-warn/40 bg-white px-2.5 py-1 font-mono text-[12px]">
                  {ip.ip_address}
                  <span className="ml-2 font-semibold text-ams-danger">risk {ip.risk_count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </DashSection>

      <DashSection title="Account Recovery">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiPanel
            title="Success rate"
            value={recStats?.total > 0 ? `${recStats.successRate}%` : '—'}
            hint={recStats?.total > 0
              ? `${recStats.total} completed attempts in this range`
              : 'No recovery attempts logged in this range'}
          />
          <KpiPanel
            title="Success"
            value={recStats?.success ?? 0}
            hint="Recovered back to a usable account"
          />
          <KpiPanel
            title="Failed"
            value={recStats?.failed ?? 0}
            hint="Could not recover"
            tone={(recStats?.failed || 0) > 0 ? 'danger' : undefined}
          />
        </div>
        {(recStats?.failReasons?.length > 0) && (
          <div className="dash-panel mt-3">
            <h4 className="dash-panel-title">Fail reasons</h4>
            <div className="space-y-3">
              {recStats.failReasons.map((r) => (
                <BarRow
                  key={r.label || r.l}
                  label={r.label || r.l}
                  val={`${r.pct ?? r.v}%`}
                  pct={r.pct ?? r.v}
                  tone={r.pct >= 35 ? 'danger' : r.pct >= 25 ? 'warn' : 'muted'}
                />
              ))}
            </div>
          </div>
        )}
      </DashSection>

      <DashSection title="SIM Top-up">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiPanel
            title="Due for top-up"
            value={simKpis.due}
            hint="Expiry reached or already overdue"
            tone={simKpis.due > 0 ? 'danger' : undefined}
          />
          <KpiPanel
            title="Expiring within 7 days"
            value={simKpis.expiring}
            hint="Needs a top-up this week"
            tone={simKpis.expiring > 0 ? 'warn' : undefined}
          />
        </div>
      </DashSection>

      <DashSection
        title="SIM Card Anomaly"
        badge={simAnomalyLoading
          ? 'Loading…'
          : `${simAnomaly?.total ?? 0} events · ${simAnomaly?.affectedSims ?? 0} SIMs`}
      >
        {!simAnomaly?.total ? (
          <div className="dash-panel">
            <div className="dash-empty-hint">
              No SIM Card Anomaly logged in this range. Log one from an account (Resource Ledger → SIM Anomaly)
              or from a card in SIM Ledger (WhatsApp or Telegram).
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="dash-panel">
              <h4 className="dash-panel-title">By reason</h4>
              <div className="space-y-3">
                {simAnomaly.byReason.map((r) => (
                  <BarRow key={r.id} label={r.label} val={r.count} pct={r.pct} tone="warn" />
                ))}
              </div>
              <h4 className="dash-panel-title mt-5">By platform</h4>
              <div className="space-y-3">
                {simAnomaly.byPlatform.map((r) => (
                  <BarRow key={r.id} label={r.label} val={r.count} pct={r.pct} tone="muted" />
                ))}
              </div>
            </div>
            <div className="dash-panel lg:col-span-2">
              <h4 className="dash-panel-title">Anomaly rate by carrier</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-ams-line text-[11px] uppercase tracking-wide text-ams-faint">
                      <th className="py-2 pr-3 font-semibold">Carrier</th>
                      <th className="py-2 pr-3 text-right font-semibold">Rate</th>
                      <th className="py-2 pr-3 text-right font-semibold">SIMs affected</th>
                      <th className="py-2 pr-3 text-right font-semibold">Suspended</th>
                      <th className="py-2 pr-3 text-right font-semibold">Expired</th>
                      <th className="py-2 text-right font-semibold">No OTP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simAnomaly.byCarrier.map((c) => (
                      <tr key={c.carrier} className="border-b border-ams-line/60 last:border-0">
                        <td className="py-2 pr-3 font-medium text-ams-ink">{c.carrier}</td>
                        <td
                          className={`py-2 pr-3 text-right font-semibold ${
                            c.rate >= 20 ? 'text-ams-danger' : c.rate >= 10 ? 'text-ams-warn' : 'text-ams-muted'
                          }`}
                        >
                          {c.rate}%
                        </td>
                        <td className="py-2 pr-3 text-right text-ams-muted">{c.affectedSims} / {c.totalSims}</td>
                        <td className="py-2 pr-3 text-right text-ams-muted">{c.reasons.service_suspended}</td>
                        <td className="py-2 pr-3 text-right text-ams-muted">{c.reasons.expired}</td>
                        <td className="py-2 text-right text-ams-muted">{c.reasons.otp_failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ams-faint">
                Rate = SIMs with at least one anomaly in this range ÷ SIMs of that carrier on the ledger.
                SIM Card Anomaly is not counted in the ban rate.
              </p>
            </div>
          </div>
        )}
      </DashSection>

      <DashSection title="Logout Rate">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiPanel
            title="Confirmed logouts"
            value={banStats?.logoutTotal ?? 0}
            hint="Keep-alive drop confirmed as logout — not counted in ban rate"
          />
          <KpiPanel
            title="False positive"
            value={banStats?.falsePositiveTotal ?? 0}
            hint="Monitor / proxy interruption — account was actually fine"
          />
          <KpiPanel
            title="Pending confirmation"
            value={banStats?.pendingBacklog ?? 0}
            hint="Backlog — ban-rate KPIs stay incomplete until Resource confirms"
            tone={(banStats?.pendingBacklog || 0) > 0 ? 'warn' : undefined}
          />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ams-faint">
          Event time is the keep-alive logout, not the Resource fill-in time. Ban rate numerator is Banned only.
        </p>
      </DashSection>

      <DashSection title="Collaboration · Tickets">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="dash-panel">
            <h4 className="dash-panel-title">Ticket Processing</h4>
            <div className="dash-stat-row">
              <span>Pending review</span>
              <span>{tkStats?.tkPending ?? 0}</span>
            </div>
            <div className="dash-stat-row">
              <span>Backlog (&gt;30 min)</span>
              <span>{tkStats?.backlogOver30 ?? 0}</span>
            </div>
            <div className="dash-stat-row">
              <span>Completed</span>
              <span>{tkStats?.tkDone ?? 0}</span>
            </div>
            <div className="dash-stat-row">
              <span>Rejected</span>
              <span className={(tkStats?.tkReject || 0) > 0 ? 'text-ams-danger' : undefined}>
                {tkStats?.tkReject ?? 0}
              </span>
            </div>
            <div className="dash-stat-row">
              <span>Avg. handling time</span>
              <span>{tkStats?.avgHandlingTime ?? '—'}</span>
            </div>
            {!liveEnd && (
              <p className="mt-2 text-[11px] text-ams-faint">
                Pending &amp; backlog reflect queue state at end of selected range{snapshotSuffix}.
              </p>
            )}
          </div>
          <div className="dash-panel">
            <h4 className="dash-panel-title">Reject reasons</h4>
            <div className="space-y-3">
              {rejReason.length === 0 ? (
                <p className="text-[12px] leading-snug text-ams-muted">No rejections recorded yet for this range.</p>
              ) : rejReason.map((r) => (
                <BarRow key={r.l} label={r.l} val={`${r.v}%`} pct={r.v} tone={r.tone} />
              ))}
            </div>
          </div>
        </div>
      </DashSection>
    </div>
  );
}
