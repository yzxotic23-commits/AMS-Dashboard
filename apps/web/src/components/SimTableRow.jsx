import { memo } from 'react';
import SimSyncPopover from './SimSyncPopover';
import { SITES, getSiteChipClass } from '../lib/sites';

function siteChipLabel(row) {
  return row.site_name || SITES[row.site]?.name || 'Malaysia';
}

function dueTag(days) {
  if (days <= 3) return 'due-soon';
  if (days <= 7) return 'due-mid';
  return 'due-far';
}

function dueLabel(days) {
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function SimTableRow({
  row,
  syncRow,
  syncBusy,
  onAlign,
  onCharge,
}) {
  const siteLabel = siteChipLabel(row);

  return (
    <tr>
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
      <td>
        <span className={`due-tag ${dueTag(row.days_left)}`}>{dueLabel(row.days_left)}</span>
      </td>
      <td>
        {row.last_charged ? (
          <span className="badge badge-success">Charged · {row.last_charged}</span>
        ) : (
          <span className="badge badge-danger">Due</span>
        )}
      </td>
      <td className="col-action">
        {row.last_charged ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCharge(row)}>Update</button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onCharge(row)}>Mark Charged</button>
        )}
      </td>
    </tr>
  );
}

export default memo(SimTableRow);
