import { Image, Maximize2 } from 'lucide-react';

function ProxyCell({ label, value }) {
  return (
    <div className="shot-proxy-cell">
      <span className="shot-proxy-k">{label}</span>
      <span className="shot-proxy-v">{value || '—'}</span>
    </div>
  );
}

/** Screenshot + expected proxy reference for operator IP review. */
export default function ScreenshotReviewPanel({ ticket, onEnlarge }) {
  const bind = ticket?.bind_proxy;
  const hasImage = Boolean(ticket?.screenshot_url);

  return (
    <div className="shot-review">
      <div className="shot-review-stage">
        {hasImage ? (
          <>
            <button
              type="button"
              className="shot-review-canvas"
              onClick={onEnlarge}
              aria-label="View full screenshot"
            >
              <img
                src={ticket.screenshot_url}
                alt="Business IP setup screenshot"
              />
            </button>
            <button
              type="button"
              className="shot-review-expand"
              onClick={onEnlarge}
            >
              <Maximize2 size={14} strokeWidth={2.25} aria-hidden="true" />
              View full size
            </button>
          </>
        ) : (
          <div className="shot-review-canvas shot-review-canvas--empty">
            <Image size={28} strokeWidth={1.5} className="text-ams-faint" aria-hidden="true" />
            <span>No screenshot uploaded</span>
          </div>
        )}
      </div>

      {bind?.ip_address && (
        <section className="shot-proxy-card" aria-label="Expected proxy on screenshot">
          <div className="shot-proxy-head">
            <h4 className="shot-proxy-title">Expected on screenshot</h4>
            <p className="shot-proxy-hint">Match these values against the screenshot above</p>
          </div>
          <div className="shot-proxy-grid">
            <ProxyCell label="IP address" value={bind.ip_address} />
            <ProxyCell label="Port" value={bind.port} />
            <ProxyCell label="Username" value={bind.username} />
            <ProxyCell label="Password" value={bind.password} />
          </div>
        </section>
      )}
    </div>
  );
}
