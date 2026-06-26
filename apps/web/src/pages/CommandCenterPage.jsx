import { useNavigate } from 'react-router-dom';
import PageHead from '../components/PageHead';
import { useSite } from '../context/SiteContext';
import { SITES } from '../lib/sites';
import { HUB_COLS, HUB_TASK_TONE } from '../lib/wireframe-data';
import { useHubCounts, useHubOperators } from '../hooks/useHubCounts';

export default function CommandCenterPage() {
  const navigate = useNavigate();
  const { site } = useSite();
  const { rows: list, rosterLoading, rosterError } = useHubOperators(site);
  const { total: totalPending } = useHubCounts(site);

  return (
    <div>
      <PageHead
        title="Control Center"
        description="Live pipeline counts across Register → Activation → Nurturing → Recovery. Lit cells need action today."
        actions={(
          <div className="page-meta-bubble">
            <span className="font-medium text-ams-ink">{SITES[site].name}</span>
            <span className="text-ams-faint">·</span>
            <span className="font-medium text-ams-accent">{totalPending} pending</span>
          </div>
        )}
      />

      <div className="card hub-panel overflow-hidden">
        <div className="hub-grid head">
          <div className="hub-cell who">Operator</div>
          {HUB_COLS.map((c) => (
            <div key={c.key} className="hub-cell">{c.label}</div>
          ))}
        </div>
        {rosterLoading && (
          <div className="px-5 py-8 text-center text-sm text-ams-muted">Loading operators…</div>
        )}
        {!rosterLoading && rosterError && (
          <div className="px-5 py-8 text-center text-sm text-ams-danger">
            Could not load operators — restart API server, then refresh this page.
          </div>
        )}
        {!rosterLoading && !rosterError && list.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-ams-muted">
            No operators yet. Add Operator accounts in User management.
          </div>
        )}
        {!rosterLoading && !rosterError && list.map((person) => (
          <div key={person.code} className="hub-grid">
            <div className="hub-cell who">
              <div className="hub-avatar">{person.name.charAt(0).toUpperCase()}</div>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold text-ams-ink">{person.name}</div>
                <div className="text-[11px] text-ams-faint">{person.siteLabel}</div>
              </div>
            </div>
            {HUB_COLS.map((col) => {
              const n = person[col.key] || 0;
              const tone = HUB_TASK_TONE[col.tone];
              const route = col.key === 'tk'
                ? `/tickets?owner=${encodeURIComponent(person.name)}`
                : col.route;
              if (n > 0) {
                return (
                  <div key={col.key} className="hub-cell">
                    <button
                      type="button"
                      onClick={() => navigate(route)}
                      className={`hub-task on ${tone}`}
                    >
                      <span className="hub-task-num">{n}</span>
                      <span className="hub-task-label">{col.label}</span>
                    </button>
                  </div>
                );
              }
              return (
                <div key={col.key} className="hub-cell">
                  <div className="hub-task off">
                    <span className="hub-task-num">0</span>
                    <span className="hub-task-label">{col.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
