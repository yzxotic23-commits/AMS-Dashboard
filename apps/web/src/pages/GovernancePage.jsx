import { Plug } from 'lucide-react';
import PageHead from '../components/PageHead';
import KpiInfoTip from '../components/KpiInfoTip';
import { useSite } from '../context/SiteContext';
import { useGovernanceDate } from '../context/GovernanceDateContext';
import { SITES } from '../lib/sites';
import { useBanStats } from '../hooks/useBanStats';
import { useRecoveryStats } from '../hooks/useRecoveryStats';
import { useSupplyStats } from '../hooks/useSupplyStats';
import { useTicketStats } from '../hooks/useTickets';
import { BAD_IP_FLAG_THRESHOLD } from '../lib/ban-analytics';
import { kpiInfoForSupply } from '../lib/supplyKpiInfo';
import { formatRangeCompact, isRangeEndingToday } from '../lib/governanceDateRange';

const BAR_TONE = {
  danger: 'bar-row-fill-danger',
  warn: 'bar-row-fill-warn',
  muted: 'bar-row-fill-muted',
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

function StatBlock({ value, label, tone }) {
  const toneClass = tone === 'danger' ? 'text-ams-danger' : tone === 'warn' ? 'text-ams-warn' : 'text-ams-ink';
  return (
    <div>
      <div className={`text-2xl font-bold tracking-tight ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ams-muted">{label}</div>
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
      count: b.count,
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
        badge={banLoading ? 'Loading…' : `Overall ${overallBan} · ${banStats?.total ?? 0} events`}
      >
        {byStage.length === 0 ? (
          <div className="dash-panel">
            <div className="dash-empty-hint">
              No ban events recorded yet for this range. When bans occur, this is the first place to look — a rising ban rate is addressed at its root (usage / IP / warming quality), not by adding devices or stock.
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {byStage.map((b) => (
            <MetricCard
              key={b.name}
              name={b.name}
              value={`${b.val}%`}
              sub={b.count != null ? `(${b.count})` : null}
              pct={Math.min(100, b.val * 5)}
              pctLabel={`${b.val}% of bans`}
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
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="dash-panel">
            <h4 className="dash-panel-title">Recovery Success Rate</h4>
            <div className="mb-1 text-3xl font-bold tracking-tight text-ams-ink">
              {recStats?.total > 0 ? `${recStats.successRate}%` : '—'}
            </div>
            <p className="mb-4 text-xs text-ams-muted">
              {recStats?.detail || 'No recovery attempts logged yet for this range.'}
            </p>
            <div className="space-y-3">
              {(recStats?.failReasons?.length ? recStats.failReasons : []).map((r) => (
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
          <div className="dash-panel">
            <h4 className="dash-panel-title">SIM Top-up</h4>
            <div className="flex gap-10">
              <StatBlock value="—" label="due for top-up" tone="danger" />
              <StatBlock value="—" label="expiring within 7 days" tone="warn" />
            </div>
          </div>
        </div>
      </DashSection>

      <DashSection title="Logout Rate">
        <div className="dash-panel flex items-start gap-4 border-dashed bg-ams-surface-muted/50">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ams-surface-muted text-ams-faint">
            <Plug size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ams-ink">Engine health sync active</div>
            <p className="mt-1 text-xs leading-relaxed text-ams-muted">
              Logged-out slots from FeedFlow bridge auto-update account status. Full logout analytics pending.
            </p>
          </div>
        </div>
      </DashSection>

      <DashSection title="Collaboration · Tickets">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="dash-panel">
            <h4 className="dash-panel-title">Ticket Processing</h4>
            <div className="dash-stat-row"><span>Pending review</span><span>{tkStats?.tkPending ?? 0}</span></div>
            <div className="dash-stat-row">
              <span>Avg. handling time</span>
              <span>{tkStats?.avgHandlingTime ?? '—'}</span>
            </div>
            <div className="dash-stat-row">
              <span>Backlog (&gt;30 min)</span>
              <span>{tkStats?.backlogOver30 ?? 0}</span>
            </div>
            {!liveEnd && (
              <p className="mt-2 text-[11px] text-ams-faint">
                Pending &amp; backlog reflect queue state at end of selected range.
              </p>
            )}
          </div>
          <div className="dash-panel">
            <h4 className="dash-panel-title">Completed / Rejected</h4>
            <p className="mb-4 text-[13px] text-ams-muted">
              Completed <span className="font-semibold text-ams-success">{tkStats?.tkDone ?? 0}</span>
              {' · '}
              Rejected <span className="font-semibold text-ams-danger">{tkStats?.tkReject ?? 0}</span>
            </p>
            <div className="space-y-3">
              {rejReason.length === 0 ? (
                <p className="text-xs text-ams-muted">No rejections recorded yet for this range.</p>
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
