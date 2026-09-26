import { memo } from 'react';
import { Trash2 } from 'lucide-react';
import SimSyncPopover from './SimSyncPopover';
import SimRemarkCell from './SimRemarkCell';
import IconTooltip from './IconTooltip';
import { SITES, getSiteChipClass } from '../lib/sites';
import { daysLeftTagClass, formatDaysLeft, ledgerStatusLabel } from '../lib/sim-meta';

function siteChipLabel(row) {
  return row.site_name || SITES[row.site]?.name || 'Malaysia';
}

function statusBadgeClass(status) {
  if (status === 'stop_topup') return 'badge badge-danger';
  if (status === 'pending_review') return 'badge badge-warn';
  return 'badge badge-success';
}

function SimTableRow({
  row,
  selected,
  selectable,
  onToggleSelect,
  syncRow,
  syncBusy,
  remarkBusy,
  onAlign,
  onCharge,
  onHistory,
  onException,
  onDelete,
  onStatusChange,
  onRemarkSave,
}) {
  const siteLabel = siteChipLabel(row);
  const stopped = row.ledger_status === 'stop_topup';
  const linked = Boolean(row.account_linked);

  return (
    <tr>
      <td className="col-check">
        <input
          type="checkbox"
          className="ams-check"
          checked={Boolean(selected)}
          disabled={!selectable}
          aria-label={`Select ${row.phone_number}`}
          onChange={(e) => onToggleSelect?.(row.id, e.target.checked)}
        />
      </td>
      <td className="col-mono">{row.phone_number}</td>
      <td>{row.carrier}</td>
      <td>
        <span className={getSiteChipClass(row.site)}>
          {siteLabel}
        </span>
      </td>
      <td className="col-strong">
        <SimSyncPopover
          accountName={row.account_name || '—'}
          simPhone={row.phone_number}
          syncRow={syncRow}
          busy={syncBusy}
          onAlign={onAlign}
        />
      </td>
      <td className="whitespace-nowrap">
        {row.brand ? (
          <span className="badge badge-accent">{row.brand}</span>
        ) : (
          <span className="text-[12.5px] text-ams-faint">—</span>
        )}
      </td>
      <td className="whitespace-nowrap">
        <select
          className="input py-1 text-[12px]"
          style={{ width: 'auto', minWidth: '8.5rem' }}
          value={row.ledger_status || 'active'}
          aria-label={`SIM status for ${row.phone_number}`}
          onChange={(e) => onStatusChange?.(row, e.target.value)}
        >
          <option value="active">Active</option>
          <option value="pending_review">Pending Review</option>
          <option value="stop_topup">Stop Top-up</option>
        </select>
      </td>
      <td>
        <span className={`due-tag ${daysLeftTagClass(row.days_left)}`}>
          {formatDaysLeft(row.days_left)}
        </span>
      </td>
      <td>
        {stopped ? (
          <span className={statusBadgeClass('stop_topup')}>Stop Top-up</span>
        ) : row.last_charged ? (
          <span className="badge badge-success">Charged · {row.last_charged}</span>
        ) : (
          <span className="badge badge-danger">Due</span>
        )}
      </td>
      <SimRemarkCell
        remark={row.remark}
        updatedAt={row.remark_updated_at}
        updatedBy={row.remark_updated_by}
        phone={row.phone_number}
        busy={remarkBusy}
        onSave={(next) => onRemarkSave?.(row, next)}
      />
      <td className="col-action col-action--wide">
        <div className="col-action-btns">
          {!stopped && (
            row.last_charged ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCharge(row)}>Update</button>
            ) : (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onCharge(row)}>Mark Charged</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onException(row)}>Exception</button>
              </>
            )
          )}
          {stopped && (
            <span className="text-[11px] text-ams-faint" title={ledgerStatusLabel(row.ledger_status)}>
              No top-up
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onHistory(row)}>
            History{row.topup_count ? ` (${row.topup_count})` : ''}
          </button>
          {linked ? (
            <IconTooltip label="Linked to account — unlink first">
              <button
                type="button"
                className="table-icon-btn table-icon-btn--danger opacity-40"
                disabled
                aria-label={`Delete ${row.phone_number} (linked)`}
              >
                <Trash2 size={15} strokeWidth={2} />
              </button>
            </IconTooltip>
          ) : (
            <IconTooltip label="Delete from SIM ledger">
              <button
                type="button"
                className="table-icon-btn table-icon-btn--danger"
                onClick={() => onDelete?.(row)}
                aria-label={`Delete ${row.phone_number}`}
              >
                <Trash2 size={15} strokeWidth={2} />
              </button>
            </IconTooltip>
          )}
        </div>
      </td>
    </tr>
  );
}

export default memo(SimTableRow);
