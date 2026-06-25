export default function ProxyCredentialPanel({ ip, title = 'Proxy detail' }) {
  if (!ip?.ip_address) return null;

  const port = ip.port != null && ip.port !== '' ? String(ip.port) : '8080';

  return (
    <div className="drawer-locked">
      <div className="drawer-locked-label mb-2">{title}</div>
      <div className="drawer-proxy-fields">
        <div className="drawer-proxy-row">
          <span className="drawer-proxy-k">IP</span>
          <span className="font-mono text-[13px] font-semibold text-ams-ink">{ip.ip_address}</span>
        </div>
        <div className="drawer-proxy-row">
          <span className="drawer-proxy-k">Port</span>
          <span className="font-mono text-[13px] font-semibold text-ams-ink">{port}</span>
        </div>
        <div className="drawer-proxy-row">
          <span className="drawer-proxy-k">User</span>
          <span className="font-mono text-[13px] font-semibold text-ams-ink">{ip.username || '—'}</span>
        </div>
        <div className="drawer-proxy-row">
          <span className="drawer-proxy-k">Pass</span>
          <span className="font-mono text-[13px] font-semibold text-ams-ink">{ip.password || '—'}</span>
        </div>
      </div>
    </div>
  );
}
