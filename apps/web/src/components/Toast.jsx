import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function Toast({
  open,
  message,
  tone = 'default',
  duration = 3800,
  onClose,
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open || !message) {
      setVisible(false);
      return undefined;
    }
    const enter = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => onClose?.(), duration);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(timer);
    };
  }, [open, message, duration, onClose]);

  if (!open || !message) return null;

  return createPortal(
    <div
      className={`toast-root${visible ? ' toast-root--visible' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className={`toast-pill toast-pill--${tone}`}>
        <span className="toast-dot" aria-hidden />
        <span className="toast-text">{message}</span>
      </div>
    </div>,
    document.body,
  );
}
