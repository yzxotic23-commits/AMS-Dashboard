/** Compact bound-proxy reference for ticket review. */
export default function ProxyStrip({ proxy, label = 'Bound proxy' }) {
  if (!proxy?.ip_address) return null;
  return (
    <div className="proxy-strip">
      <div className="proxy-strip-label">{label}</div>
      <dl className="proxy-strip-grid">
        <div><dt>IP</dt><dd>{proxy.ip_address}</dd></div>
        <div><dt>Port</dt><dd>{proxy.port}</dd></div>
        <div><dt>User</dt><dd>{proxy.username || '—'}</dd></div>
        <div><dt>Pass</dt><dd>{proxy.password || '—'}</dd></div>
      </dl>
    </div>
  );
}
