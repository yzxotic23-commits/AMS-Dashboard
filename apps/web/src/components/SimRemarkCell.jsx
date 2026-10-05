import IconTooltip from './IconTooltip';
import { simAnomalyPlatformLabel, simAnomalyReasonLabel } from '../lib/sim-meta';

function formatRemarkMeta(updatedAt, updatedBy) {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return updatedBy || null;
  const when = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return updatedBy ? `${updatedBy} · ${when}` : when;
}

/** Read-only remark: system-written SIM Card Anomaly first, otherwise any legacy remark. */
export default function SimRemarkCell({
  anomaly,
  remark,
  updatedAt,
  updatedBy,
}) {
  if (anomaly) {
    const meta = formatRemarkMeta(anomaly.created_at, anomaly.created_by);
    const rows = [
      ['Reason', simAnomalyReasonLabel(anomaly.sim_reason)],
      anomaly.platform ? ['Platform', simAnomalyPlatformLabel(anomaly.platform)] : null,
      anomaly.detail ? ['Note', anomaly.detail] : null,
    ].filter(Boolean);
    const tip = (
      <span className="block min-w-[12rem] max-w-[16rem] text-left text-[12px] leading-snug">
        <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {rows.map(([k, v]) => (
            <span key={k} className="contents">
              <span className="opacity-70">{k}</span>
              <span className="font-medium">{v}</span>
            </span>
          ))}
        </span>
        {meta && (
          <span className="mt-1.5 block border-t border-white/15 pt-1.5 text-[11px] opacity-70">
            Updated by {meta}
          </span>
        )}
      </span>
    );
    return (
      <td className="col-remark">
        <div className="sim-remark-view">
          <IconTooltip label={tip} rich>
            <span className="badge badge-warn cursor-default whitespace-nowrap" tabIndex={0}>
              SIM Anomaly
            </span>
          </IconTooltip>
        </div>
      </td>
    );
  }

  const meta = remark ? formatRemarkMeta(updatedAt, updatedBy) : null;
  return (
    <td className="col-remark">
      <div className="sim-remark-view">
        {remark ? (
          <span className="sim-remark-text">{remark}</span>
        ) : (
          <span className="text-[12.5px] text-ams-faint">—</span>
        )}
        {meta && <span className="sim-remark-meta">{meta}</span>}
      </div>
    </td>
  );
}
