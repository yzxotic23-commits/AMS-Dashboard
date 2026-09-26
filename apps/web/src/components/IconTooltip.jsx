import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VIEW_PAD = 12;

/**
 * Portal tooltip — stays above (flips below only near top of viewport).
 * Clamps horizontally so right-edge action tips are not clipped.
 */
export default function IconTooltip({ label, children, rich = false }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, place: 'above', shiftX: 0 });
  const anchorRef = useRef(null);
  const tipRef = useRef(null);
  const tipId = useId();

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const placeBelow = rect.top < 80;
    setCoords({
      top: placeBelow ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
      place: placeBelow ? 'below' : 'above',
      shiftX: 0,
    });
  }, []);

  const clampShift = useCallback(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const tipRect = tip.getBoundingClientRect();
    let shiftX = 0;
    if (tipRect.left < VIEW_PAD) shiftX = VIEW_PAD - tipRect.left;
    else if (tipRect.right > window.innerWidth - VIEW_PAD) {
      shiftX = (window.innerWidth - VIEW_PAD) - tipRect.right;
    }
    setCoords((prev) => (prev.shiftX === shiftX ? prev : { ...prev, shiftX }));
  }, []);

  const show = () => {
    updatePosition();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    e.preventDefault();
    if (open) hide();
    else show();
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => clampShift());
    return () => cancelAnimationFrame(id);
  }, [open, coords.top, coords.left, coords.place, label, clampShift]);

  useEffect(() => {
    if (!open) return undefined;
    const reposition = () => {
      updatePosition();
    };
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

  const transform = coords.place === 'above'
    ? `translate(calc(-50% + ${coords.shiftX}px), -100%)`
    : `translate(calc(-50% + ${coords.shiftX}px), 0)`;

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
          ref={tipRef}
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
            transform,
            ['--tip-arrow-left']: `calc(50% - ${coords.shiftX}px)`,
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  );
}
