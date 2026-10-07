import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
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
        <ShieldAlert size={36} strokeWidth={1.75} className="mx-auto mb-3 text-ams-danger" />
        <h1 className="mb-2 text-lg font-bold text-ams-ink">Company network only</h1>
        <p className="mb-4 text-sm text-ams-muted">
          AMS can only be accessed through the company VPN. Connect to the VPN and reload.
        </p>
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
