/** Format proxy credentials for operator-facing UI (register, nurturing scan-in). */

function normPort(port) {
  if (port == null || port === '') return '8080';
  return String(port);
}

export function formatProxyOptionLabel(ip) {
  if (!ip?.ip_address) return '—';
  const port = normPort(ip.port);
  const user = ip.username || '—';
  return `${ip.ip_address}:${port}  —  ${user}`;
}

export function formatProxyOneLine(row) {
  if (!row?.proxy_ip && !row?.ip_address) return '—';
  const ip = row.proxy_ip || row.ip_address;
  const port = normPort(row.proxy_port ?? row.port);
  const user = row.proxy_username ?? row.username ?? '—';
  return `${ip}:${port}  —  ${user}`;
}

export function proxyFieldsFromIp(ip) {
  if (!ip?.ip_address) return {};
  return {
    proxy_ip: ip.ip_address,
    proxy_port: ip.port != null && ip.port !== '' ? String(ip.port) : null,
    proxy_username: ip.username || null,
    proxy_password: ip.password || null,
  };
}
