import { SITES } from '../lib/sites';

function MetricCard({ name, value, sub }) {
  return (
    <div className="metric-card">
      <div className="text-xs font-medium text-ams-muted">{name}</div>
      <div className="metric-val">
        {value}
        {sub != null && sub !== '' && (
          <span className="text-sm font-medium text-ams-faint"> {sub}</span>
        )}
      </div>
    </div>
  );
}

function SiteRmBlock({ model, siteLabel }) {
  if (!model) return null;

  const { inputs, regDaily, mult, yield: yieldPct, warm, need, diagnosis } = model;

  return (
    <div className={siteLabel ? 'mb-4 last:mb-0' : ''}>
      {siteLabel && (
        <div className="mb-2 text-xs font-semibold text-ams-muted">{siteLabel}</div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard name="Daily registration" value={regDaily} sub="/ day" />
        <MetricCard name="Multiplier" value={`×${mult}`} />
        <MetricCard name="Yield" value={`${yieldPct}%`} />
        <MetricCard name="Registering now" value={model.registering ?? 0} />
        <MetricCard name="In use" value={inputs.active} />
        <MetricCard name="Ban rate" value={`${inputs.D}%`} />
        <MetricCard name="Recovery" value={`${inputs.R}%`} />
        <MetricCard name="Reg fail" value={`${inputs.Fr}%`} />
        <MetricCard name="Nurture ban" value={`${inputs.Wf}%`} />
        <MetricCard name="Nurturing target" value={warm} sub={`/ ${inputs.W}d`} />
        <MetricCard name="Daily loss" value={need} />
        <MetricCard name="Recovery backlog" value={model.rec} />
      </div>
      {diagnosis?.rows?.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ams-muted">
          {diagnosis.rows.map((row) => (
            <li key={row.id}>
              <span className="font-medium text-ams-warn">{row.cause}</span>
              {' — '}
              {row.action}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** RM Operation Logic — same metric-card layout as Governance. */
export default function RmSupplyPanel({ model, site = 'all', loading }) {
  if (loading) {
    return <p className="mb-6 text-sm text-ams-muted">Loading supply model…</p>;
  }

  if (!model) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 border-b border-ams-line pb-2">
        <h3 className="text-sm font-semibold text-ams-ink">RM Supply Model</h3>
        <span className="rounded bg-ams-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ams-faint">
          v3.2 · from ban rate
        </span>
      </div>

      {site === 'all' && model.sites ? (
        <div className="space-y-5">
          <SiteRmBlock model={model.sites.my} siteLabel={SITES.my.name} />
          <SiteRmBlock model={model.sites.pp} siteLabel={SITES.pp.name} />
        </div>
      ) : (
        <SiteRmBlock model={model.sites ? model.sites[site] : model} />
      )}
    </section>
  );
}
