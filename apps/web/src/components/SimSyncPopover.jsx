import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Link2 } from 'lucide-react';

const ISSUE_LABELS = {
  phone_mismatch: 'Phone mismatch',
  unlinked_sim_match: 'Not linked',
  wrong_sim_link: 'Wrong link',
  missing_sim: 'Missing SIM',
};

const ISSUE_HINTS = {
  phone_mismatch: 'Account phone differs from SIM. Align copies the SIM number to the account.',
  unlinked_sim_match: 'Numbers match but the account is not linked to this SIM.',
  wrong_sim_link: 'Account is linked to a different SIM. Align fixes the link.',
  missing_sim: 'Account has a SIM ID but the card was not found.',
};

export default function SimSyncPopover({
  accountName,
  simPhone,
  syncRow,
  busy,
  onAlign,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const popoverRef = useRef(null);

  const needsAction = Boolean(syncRow?.needs_action && accountName && accountName !== '—');

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 6,
      left: rect.left,
    });
  }, []);

  const toggle = () => {
    if (!needsAction) return;
    if (!open) updatePosition();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (
        anchorRef.current?.contains(e.target)
        || popoverRef.current?.contains(e.target)
      ) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const reposition = () => updatePosition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, updatePosition]);

  async function handleAlign() {
    await onAlign?.();
    setOpen(false);
  }

  if (!accountName || accountName === '—') {
    return <span className="text-ams-faint">—</span>;
  }

  if (!needsAction) {
    return <span className="col-strong-text">{accountName}</span>;
  }

  const label = ISSUE_LABELS[syncRow.issue] || 'Needs align';
  const hint = ISSUE_HINTS[syncRow.issue] || ISSUE_HINTS.phone_mismatch;
  const accountPhone = syncRow.account_phone || '—';
  const targetPhone = syncRow.sim_phone || simPhone || '—';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="sim-sync-trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="sim-sync-trigger__dot" aria-hidden />
        {accountName}
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="sim-sync-popover"
          role="dialog"
          aria-label={label}
          style={{ top: coords.top, left: coords.left }}
        >
          <div className="sim-sync-popover__head">
            <AlertCircle size={14} strokeWidth={2.25} />
            <span>{label}</span>
          </div>

          {syncRow.issue === 'phone_mismatch' ? (
            <dl className="sim-sync-popover__diff">
              <div>
                <dt>Account</dt>
                <dd>{accountPhone}</dd>
              </div>
              <div>
                <dt>SIM</dt>
                <dd>{targetPhone}</dd>
              </div>
            </dl>
          ) : (
            <p className="sim-sync-popover__mono">{targetPhone}</p>
          )}

          <p className="sim-sync-popover__hint">{hint}</p>

          {syncRow.account_id && (
            <button
              type="button"
              className="sim-sync-popover__btn"
              disabled={busy}
              onClick={handleAlign}
            >
              <Link2 size={13} strokeWidth={2.25} />
              {busy ? 'Aligning…' : 'Align now'}
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
