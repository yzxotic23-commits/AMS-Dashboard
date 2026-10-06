import net from 'node:net';

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

export function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  return ip;
}

/**
 * Public client IP. Forwarded headers are only trusted behind a proxy that rewrites
 * them (Vercel always does; other proxies need TRUST_PROXY=1), otherwise anyone
 * could spoof an allowlisted address.
 */
export function clientIp(req) {
  const h = req?.headers || {};
  let forwarded = '';
  if (process.env.VERCEL) {
    forwarded = firstHeaderValue(h['x-vercel-forwarded-for'])
      || firstHeaderValue(h['x-real-ip'])
      || firstHeaderValue(h['x-forwarded-for']);
  } else if (process.env.TRUST_PROXY === '1') {
    forwarded = firstHeaderValue(h['x-forwarded-for']) || firstHeaderValue(h['x-real-ip']);
  }
  return normalizeIp(forwarded || req?.socket?.remoteAddress || '');
}
