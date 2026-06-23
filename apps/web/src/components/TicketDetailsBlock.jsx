function MetaItem({ label, value, mono = false }) {
  return (
    <div className="tk-meta-item">
      <span className="tk-meta-k">{label}</span>
      <span className={`tk-meta-v${mono ? ' mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function ProxyConfigGrid({ proxy }) {
  if (!proxy?.ip_address) return null;
  return (
    <div className="tk-meta tk-meta--nested">
      <MetaItem label="IP address" value={proxy.ip_address} mono />
      <MetaItem label="Port" value={proxy.port} mono />
      <MetaItem label="Username" value={proxy.username} mono />
      <MetaItem label="Password" value={proxy.password} mono />
    </div>
  );
}

function proxyOneLiner(proxy) {
  if (!proxy?.ip_address) return '';
  return `${proxy.ip_address}:${proxy.port || '8080'}`;
}

/** tk-meta + satu tk-detail collapsible (4 field proxy) — seperti wireframe. */
export default function TicketDetailsBlock({ ticket, bind }) {
  const proxy = bind?.ip_address ? bind : ticket.shot_proxy;
  const deviceSlot = ticket.device_name && ticket.device_name !== '—'
    ? ticket.device_name
    : '';

  return (
    <>
      <div className="tk-meta">
        <MetaItem label="Name" value={ticket.account_name} />
        <MetaItem label="Phone" value={ticket.phone_number} mono />
        <MetaItem label="Device" value={deviceSlot} mono />
        <MetaItem label="Channel" value={ticket.channel} />
        {proxy?.ip_address && (
          <MetaItem label="Proxy used" value={proxyOneLiner(proxy)} mono />
        )}
      </div>

      {proxy?.ip_address && (
        <details className="tk-detail">
          <summary>Full proxy config (4 fields)</summary>
          <ProxyConfigGrid proxy={proxy} />
        </details>
      )}
    </>
  );
}
