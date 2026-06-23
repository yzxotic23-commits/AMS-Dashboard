import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function ImageLightbox({ src, alt = 'Screenshot', onClose }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  useEffect(() => {
    if (!src) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    }
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [src, onClose]);

  if (!src) return null;

  return createPortal(
    <div className="image-lightbox" role="presentation" onClick={onClose}>
      <button
        type="button"
        className="image-lightbox-close"
        onClick={onClose}
        aria-label="Close full screenshot"
      >
        <X size={20} strokeWidth={2} />
      </button>
      {failed ? (
        <p className="text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
          Screenshot could not be loaded.
        </p>
      ) : (
        <img
          src={src}
          alt={alt}
          className="image-lightbox-img"
          onClick={(e) => e.stopPropagation()}
          onError={() => setFailed(true)}
        />
      )}
    </div>,
    document.body,
  );
}
