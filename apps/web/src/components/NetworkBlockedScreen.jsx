import { useEffect, useState } from 'react';
import { IP_BLOCKED_EVENT } from '../lib/api';

/** Full-screen notice once the API rejects this network (IP allowlist). */
export default function NetworkBlockedScreen() {
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    const onBlocked = (e) => setBlocked({ ip: e.detail?.ip || '' });
    window.addEventListener(IP_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(IP_BLOCKED_EVENT, onBlocked);
  }, []);

  if (!blocked) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ams-canvas/95 p-6 backdrop-blur-sm">
      <div className="card max-w-md p-8 text-center">
        <p className="mb-1 text-5xl font-bold tracking-tight text-ams-ink">404</p>
        <h1 className="mb-4 text-lg font-semibold text-ams-ink">Page not found</h1>
        <p className="mb-4 text-sm text-ams-muted">Connect to the VPN and reload.</p>
        {blocked.ip && (
          <p className="mb-5 text-xs text-ams-faint">
            Your IP: <span className="font-mono text-ams-ink">{blocked.ip}</span>. Still blocked while on the VPN? Send this IP to the AMS admin.
          </p>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
