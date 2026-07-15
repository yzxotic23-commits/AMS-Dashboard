import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal tooltip — flips below when near top of viewport; supports rich (multi-line) content.
 */
export default function IconTooltip({ label, children, rich = false }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, place: 'above' });
  const anchorRef = useRef(null);
  const tipId = useId();

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const placeBelow = rect.top < 80;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, 12),
      window.innerWidth - 12,
    );
    setCoords({
      top: placeBelow ? rect.bottom + 8 : rect.top - 8,
      left,
      place: placeBelow ? 'below' : 'above',
    });
  }, []);

  const show = () => {
    updatePosition();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  const onPointerUp = (e) => {
    // Touch / pen: tap to toggle (no hover). Mouse keeps enter/leave only.
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    e.preventDefault();
    if (open) hide();
    else show();
  };

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

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      hide();
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  return (
    <>
      <span
        ref={anchorRef}
        className="icon-tip"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
        onPointerUp={onPointerUp}
        aria-describedby={open ? tipId : undefined}
      >
        {children}
      </span>
      {open && createPortal(
        <span
          id={tipId}
          className={[
            'icon-tip__bubble',
            'icon-tip__bubble--portal',
            `icon-tip__bubble--${coords.place}`,
            rich ? 'icon-tip__bubble--rich' : '',
          ].filter(Boolean).join(' ')}
          role="tooltip"
          style={{
            top: coords.top,
            left: coords.left,
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  );
}
