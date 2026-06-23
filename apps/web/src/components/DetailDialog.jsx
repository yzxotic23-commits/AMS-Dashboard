import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function DetailDialog({ open, title, onClose, children, footer, cardClassName = '' }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="detail-root" role="presentation" onClick={onClose}>
      <div
        className={`detail-card${cardClassName ? ` ${cardClassName}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-header">
          <h2 className="detail-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="drawer-close"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="detail-body">{children}</div>
        {footer && (
          <div className="detail-footer">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
