import { wsafBridgeBase } from './wsafEmbed';

function base() {
  return wsafBridgeBase();
}

async function localFetch(path, options = {}) {
  const res = await fetch(`${base()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-FeedFlow-Client': 'ams-bridge',
      ...(options.headers || {}),
    },
    signal: options.signal ?? AbortSignal.timeout(options.timeout ?? 8000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data?.error || `FeedFlow HTTP ${res.status}`);
  return data;
}

export async function probeLocalEngine() {
  try {
    await localFetch('/api/health', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function fetchLocalBridgeSummary() {
  const data = await localFetch('/api/bridge/summary', { timeout: 6000 });
  return { ...data, reachable: true, source: 'local' };
}

export async function fetchLocalBridgeStatus() {
  const data = await localFetch('/api/status', { timeout: 6000 });
  return { ok: true, reachable: true, source: 'local', ...data };
}

export async function postLocalConnect(slot, body = {}) {
  return localFetch(`/api/connect/${slot}`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: 30_000,
  });
}

export async function postLocalDisconnect(slot) {
  return localFetch(`/api/disconnect/${slot}`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeout: 15_000,
  });
}

export async function fetchLocalFeedingAudit(limit = 0) {
  const q = `limit=${limit > 0 ? limit : 100000}`;
  return localFetch(`/api/audit?${q}`, { timeout: 30_000 });
}

export async function postLocalAuditSync() {
  return localFetch('/api/audit/sync', { method: 'POST', timeout: 12_000 });
}

export async function postLocalAuditRecord(payload = {}) {
  return localFetch('/api/audit/record', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 8000,
  });
}

export async function postLocalProfileRefresh() {
  return localFetch('/api/profile/refresh', { method: 'POST', timeout: 8000 });
}

export async function postLocalSlotDisplayLabel(slot, body = {}) {
  return localFetch(`/api/slots/${slot}/display-label`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: 8000,
  });
}

export async function postLocalClearSlotDisplayLabel(slot) {
  return postLocalSlotDisplayLabel(slot, { clear: true, accountName: '' });
}

export async function postLocalSlotProxy(slot, proxyUrl) {
  return localFetch(`/api/slots/${slot}/proxy`, {
    method: 'POST',
    body: JSON.stringify({ proxyUrl }),
    timeout: 15_000,
  });
}
