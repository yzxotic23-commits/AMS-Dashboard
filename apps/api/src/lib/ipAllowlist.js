import net from 'node:net';
import { supabaseAdmin } from './supabase.js';
import { clientIp, normalizeIp } from './clientIp.js';

const SETTINGS_KEY = 'ip_allowlist';
const CACHE_MS = 30_000;

let cache = { at: 0, config: null };

/** Parse "1.2.3.4", "1.2.3.0/24" or an IPv6 equivalent; null when invalid. */
export function parseAllowlistValue(value) {
  const raw = String(value || '').trim();
  const [addrRaw, prefixRaw, extra] = raw.split('/');
  if (extra !== undefined) return null;
  const addr = normalizeIp(addrRaw);
  const family = net.isIP(addr);
  if (!family) return null;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (prefixRaw === undefined) return { value: addr, type, addr, prefix: null };
  if (!/^\d{1,3}$/.test(prefixRaw)) return null;
  const prefix = Number(prefixRaw);
  if (prefix > (family === 4 ? 32 : 128)) return null;
  return { value: `${addr}/${prefix}`, type, addr, prefix };
}

const text = (v, max) => String(v || '').trim().slice(0, max);

/** "CRM | SGD 1" — kept alongside the structured fields for audit logs and older readers. */
function composeLabel({ department, user }) {
  return [department, user].filter(Boolean).join(' | ');
}

/** Entries saved before the `user` field split the name into market + line ("SGD" + "1"). */
function entryUser(e) {
  if (e?.user !== undefined) return text(e.user, 60);
  return text([e?.market, e?.line].map((v) => String(v || '').trim()).filter(Boolean).join(' '), 60);
}

export function normalizeAllowlistConfig(value) {
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  return {
    enabled: Boolean(value?.enabled),
    entries: entries
      .map((e) => {
        const parsed = parseAllowlistValue(e?.value);
        if (!parsed) return null;
        const fields = {
          department: text(e?.department, 40),
          user: entryUser(e),
          remark: text(e?.remark, 200),
          active: e?.active !== false,
        };
        const label = composeLabel(fields) || text(e?.label, 80);
        return { value: parsed.value, ...fields, label: label.slice(0, 80) };
      })
      .filter(Boolean),
  };
}

function buildBlockList(entries) {
  const list = new net.BlockList();
  for (const e of entries) {
    if (e.active === false) continue;
    const parsed = parseAllowlistValue(e.value);
    if (!parsed) continue;
    if (parsed.prefix == null) list.addAddress(parsed.addr, parsed.type);
    else list.addSubnet(parsed.addr, parsed.prefix, parsed.type);
  }
  return list;
}

export function ipMatchesAllowlist(ip, entries) {
  const addr = normalizeIp(ip);
  const family = net.isIP(addr);
  if (!family) return false;
  return buildBlockList(entries).check(addr, family === 4 ? 'ipv4' : 'ipv6');
}

export async function loadIpAllowlist({ fresh = false } = {}) {
  if (!fresh && cache.config && Date.now() - cache.at < CACHE_MS) return cache.config;
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('value, updated_at, updated_by')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  const config = {
    ...normalizeAllowlistConfig(data?.value),
    updated_at: data?.updated_at || null,
    updated_by: data?.updated_by || null,
  };
  cache = { at: Date.now(), config };
  return config;
}

export async function saveIpAllowlist(config, userId) {
  const value = normalizeAllowlistConfig(config);
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString(), updated_by: userId || null });
  if (error) throw error;
  cache = { at: 0, config: null };
  return loadIpAllowlist({ fresh: true });
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1';
}

/**
 * Blocks every /api/v1 request from outside the company network once the allowlist
 * is enabled. IP_ALLOWLIST_BYPASS=1 is the emergency switch if admins lock themselves out.
 */
export async function ipAllowlistGate(req, res, next) {
  if (process.env.IP_ALLOWLIST_BYPASS === '1' || req.path === '/health') return next();
  try {
    const config = await loadIpAllowlist();
    if (!config.enabled) return next();
    const ip = clientIp(req);
    if (isLoopback(ip) || ipMatchesAllowlist(ip, config.entries)) return next();
    console.warn(`[ip-allowlist] blocked ${ip} ${req.method} ${req.originalUrl}`);
    return res.status(403).json({
      error: 'AMS can only be accessed from the company network',
      code: 'IP_NOT_ALLOWED',
      ip,
    });
  } catch (e) {
    // Fail closed only when we know the allowlist is on; a settings read error must not lock everyone out.
    console.error('[ip-allowlist] check failed:', e.message);
    if (cache.config?.enabled) {
      return res.status(503).json({ error: 'Access check unavailable — try again shortly', code: 'IP_CHECK_FAILED' });
    }
    return next();
  }
}
