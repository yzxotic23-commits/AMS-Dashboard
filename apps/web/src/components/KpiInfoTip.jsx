import {
  useCallback, useEffect, useId, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

const TIP_WIDTH = 216;
const GAP = 10;
const VIEWPORT_MARGIN = 12;

function resolveCoords(rect, preferred) {
  const centerX = rect.left + rect.width / 2;
  const top = rect.top - GAP;

  if (preferred === 'left') {
    return { top, left: rect.left, placement: 'left' };
  }
  if (preferred === 'right') {
    return { top, left: rect.right, placement: 'right' };
  }

  const half = TIP_WIDTH / 2;
  let left = centerX;
  if (left - half < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN + half;
  } else if (left + half > window.innerWidth - VIEWPORT_MARGIN) {
    left = window.innerWidth - VIEWPORT_MARGIN - half;
  }

  return { top, left, placement: 'center' };
}

function tipTransform(placement) {
  const y = 'calc(-100% - 6px)';
  if (placement === 'right') return `translate(-100%, ${y})`;
  if (placement === 'left') return `translate(calc(-100% - 4px), ${y})`;
  return `translate(-50%, ${y})`;
}

export default function KpiInfoTip({
  title, body, formula, align = 'center',
}) {
  const tipId = useId();
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: 'center' });

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setCoords(resolveCoords(el.getBoundingClientRect(), align));
  }, [align]);

  const show = useCallback(() => {
    reposition();
    setOpen(true);
  }, [reposition]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition]);

  const tooltip = open ? (
    <span
      id={tipId}
      role="tooltip"
      className={`kpi-info-tip kpi-info-tip--portal kpi-info-tip--${coords.placement}`}
      style={{
        top: coords.top,
        left: coords.left,
        width: TIP_WIDTH,
        transform: tipTransform(coords.placement),
      }}
    >
      <span className="kpi-info-title">{title}</span>
      <span className="kpi-info-body">{body}</span>
      {formula && <span className="kpi-info-formula">{formula}</span>}
    </span>
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className="kpi-info"
        tabIndex={0}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        i
      </span>
      {tooltip && createPortal(tooltip, document.body)}
    </>
  );
}
