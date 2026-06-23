import api from './api';
import {
  fetchLocalBridgeSummary,
  fetchLocalBridgeStatus,
  fetchLocalFeedingAudit,
  postLocalAuditSync,
  postLocalConnect,
  postLocalDisconnect,
  postLocalProfileRefresh,
  probeLocalEngine,
} from './wsafLocalBridge';

async function tryApi(fn) {
  try {
    const { data } = await fn();
    if (data?.reachable === false) return null;
    return data;
  } catch {
    return null;
  }
}

export async function getBridgeSummary() {
  const fromApi = await tryApi(() => api.get('/bridge/summary'));
  if (fromApi?.reachable !== false && fromApi?.engine != null) return fromApi;
  try {
    return await fetchLocalBridgeSummary();
  } catch (e) {
    return fromApi || {
      ok: false,
      reachable: false,
      error: e.message || 'FeedFlow engine is not running on this computer.',
    };
  }
}

export async function getBridgeStatus() {
  const fromApi = await tryApi(() => api.get('/bridge/status'));
  if (fromApi?.reachable !== false) return fromApi;
  try {
    return await fetchLocalBridgeStatus();
  } catch {
    return fromApi || { ok: false, reachable: false, accounts: [] };
  }
}

export async function startBridgeEngine() {
  const fromApi = await tryApi(() => api.post('/bridge/engine/start'));
  if (fromApi?.reachable) return fromApi;
  const live = await probeLocalEngine();
  if (live) return fetchLocalBridgeStatus();
  throw new Error('FeedFlow engine is not running. Start npm run dev on this PC.');
}

export async function connectBridgeSlot(slot, body = {}) {
  try {
    const { data } = await api.post(`/bridge/connect/${slot}`, body);
    return data;
  } catch {
    return postLocalConnect(slot, body);
  }
}

export async function disconnectBridgeSlot(slot) {
  try {
    const { data } = await api.post(`/bridge/disconnect/${slot}`);
    return data;
  } catch {
    return postLocalDisconnect(slot);
  }
}

export async function getFeedingAudit(limit = 100) {
  const fromApi = await tryApi(() => api.get('/bridge/audit', { params: { limit } }));
  if (fromApi?.entries) return fromApi;
  try {
    return await fetchLocalFeedingAudit(limit);
  } catch {
    return fromApi || { entries: [] };
  }
}

export async function refreshBridgeState() {
  try {
    await api.post('/bridge/refresh');
  } catch {
    await postLocalProfileRefresh().catch(() => {});
  }
  try {
    await api.post('/bridge/audit/sync');
  } catch {
    await postLocalAuditSync().catch(() => {});
  }
  return getBridgeSummary();
}
