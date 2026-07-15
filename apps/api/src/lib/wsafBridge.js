const DEFAULT_URL = 'http://127.0.0.1:47821';
const TIMEOUT_MS = 4000;

function bridgeBase() {
  return (process.env.WSAF_BRIDGE_URL || DEFAULT_URL).replace(/\/$/, '');
}

async function wsafRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${bridgeBase()}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-FeedFlow-Client': 'ams-bridge',
        ...(options.headers || {}),
      },
    });
    const text = await res.text().catch(() => '');
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      throw new Error(data?.error || text || `WSAF bridge HTTP ${res.status}`);
    }
    return data;
  } catch (e) {
    throw formatWsafError(e);
  } finally {
    clearTimeout(timer);
  }
}

function formatWsafError(e) {
  if (e.name === 'AbortError') {
    return new Error('FeedFlow engine timed out. Retry or restart the AMS API.');
  }
  const msg = String(e.message || '');
  if (
    msg === 'fetch failed'
    || msg.includes('ECONNREFUSED')
    || msg.includes('ENOTFOUND')
    || msg.includes('Failed to fetch')
  ) {
    return new Error(
      'FeedFlow engine is not running. Ensure the AMS API is active — engine auto-starts on port 47821.',
    );
  }
  return e instanceof Error ? e : new Error(msg || 'FeedFlow bridge error');
}

export async function fetchWsafBridgeSummary() {
  try {
    const data = await wsafRequest('/api/bridge/summary');
    return { ...data, reachable: true };
  } catch (e) {
    const message = e.name === 'AbortError'
      ? 'Engine not responding (timeout)'
      : (e.message || 'Engine offline');
    return {
      ok: false,
      reachable: false,
      version: null,
      engine: null,
      slots: [],
      feeding: null,
      error: message,
    };
  }
}

export async function fetchWsafEngineStatus() {
  return wsafRequest('/api/status', { timeout: 6000 });
}

export async function postWsafConnect(slot, body = {}) {
  return wsafRequest(`/api/connect/${slot}`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: 30_000,
  });
}

export async function postWsafDisconnect(slot) {
  return wsafRequest(`/api/disconnect/${slot}`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeout: 15_000,
  });
}

async function postWsafFeedingAction(path) {
  const data = await wsafRequest(path, {
    method: 'POST',
    body: JSON.stringify({}),
    timeout: path.includes('start') ? 120_000 : 15_000,
  });
  if (data?.ok === false) {
    throw new Error(data.error || 'Feeding action failed');
  }
  return data;
}

export async function postWsafStartFeeding() {
  return postWsafFeedingAction('/api/feeding/start');
}

export async function postWsafStopFeeding() {
  return postWsafFeedingAction('/api/feeding/stop');
}

export async function postWsafSlotDisplayLabel(slot, payload = {}) {
  return wsafRequest(`/api/slots/${slot}/display-label`, {
    method: 'POST',
    body: JSON.stringify({
      accountName: payload.accountName,
      phone: payload.phone,
      siteKey: payload.siteKey,
      location: payload.location,
      ipAddress: payload.ipAddress,
    }),
    timeout: 8000,
  });
}

export async function postWsafSlotProxy(slot, proxyUrl) {
  return wsafRequest(`/api/slots/${slot}/proxy`, {
    method: 'POST',
    body: JSON.stringify({ proxyUrl }),
    timeout: 15_000,
  });
}

export async function postWsafAuditSync() {
  return wsafRequest('/api/audit/sync', { method: 'POST', timeout: 12_000 });
}

/** Append/update a feeding audit entry on the FeedFlow engine. */
export async function postWsafAuditRecord(payload = {}) {
  return wsafRequest('/api/audit/record', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 8000,
  });
}

export async function postWsafProfileRefresh() {
  return wsafRequest('/api/profile/refresh', { method: 'POST', timeout: 8000 });
}

export async function refreshWsafBridgeState() {
  try {
    await postWsafProfileRefresh();
  } catch {
    /* engine may be offline */
  }
  try {
    await postWsafAuditSync();
  } catch {
    /* audit sync optional */
  }
  return fetchWsafBridgeSummary();
}

/** Large page size = “all rows” while staying compatible with older engines
 *  that treated limit=0 as slice(0,0) → empty list. */
const FEEDING_AUDIT_ALL = 100_000;

export async function fetchWsafFeedingAudit({ limit = FEEDING_AUDIT_ALL, offset = 0 } = {}) {
  const safeLimit = !limit || limit <= 0 ? FEEDING_AUDIT_ALL : limit;
  const params = new URLSearchParams({
    limit: String(safeLimit),
    offset: String(offset || 0),
  });
  return wsafRequest(`/api/audit?${params}`, { timeout: 30_000 });
}
