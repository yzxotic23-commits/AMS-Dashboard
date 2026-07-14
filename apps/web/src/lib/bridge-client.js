import api from './api';
import { bridgeEngineLabel, isLocalBridge } from './wsafEmbed';
import {
  fetchLocalBridgeSummary,
  fetchLocalBridgeStatus,
  fetchLocalFeedingAudit,
  postLocalAuditSync,
  postLocalConnect,
  postLocalDisconnect,
  postLocalProfileRefresh,
  postLocalSlotDisplayLabel,
  postLocalSlotProxy,
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
      error: e.message || `FeedFlow ${bridgeEngineLabel()} is not reachable.`,
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

/** Slots from either /bridge/summary or /bridge/status payload. */
export function engineSlotsFromPayload(data) {
  return data?.slots || data?.accounts || [];
}

export function findEngineSlot(data, slot) {
  if (data == null || slot == null) return null;
  return engineSlotsFromPayload(data).find((s) => Number(s.slot) === Number(slot)) || null;
}

export async function getEngineSlotState(slot) {
  const summary = await getBridgeSummary();
  const fromSummary = findEngineSlot(summary, slot);
  if (fromSummary?.connected) return { ...fromSummary, reachable: summary?.reachable !== false };
  const status = await getBridgeStatus();
  const fromStatus = findEngineSlot(status, slot);
  return {
    ...(fromStatus || fromSummary),
    reachable: (status?.reachable !== false) || (summary?.reachable === true),
  };
}

export async function startBridgeEngine() {
  if (!isLocalBridge()) {
    const live = await probeLocalEngine().catch(() => false);
    if (live) return fetchLocalBridgeStatus();
    throw new Error('FeedFlow cloud engine is offline. Check Railway service status, then refresh.');
  }
  const fromApi = await tryApi(() => api.post('/bridge/engine/start'));
  if (fromApi?.reachable) return fromApi;
  const live = await probeLocalEngine();
  if (live) return fetchLocalBridgeStatus();
  throw new Error('FeedFlow engine is not running. Start npm run dev on this PC.');
}

/** Browser → configured engine URL (Railway or localhost), then AMS API proxy. */
export async function connectBridgeSlot(slot, body = {}) {
  const engineUp = await probeLocalEngine().catch(() => false);
  if (engineUp) {
    try {
      return await postLocalConnect(slot, body);
    } catch {
      /* fall through to API proxy */
    }
  }
  try {
    const { data } = await api.post(`/bridge/connect/${slot}`, body);
    return data;
  } catch (e) {
    if (engineUp) throw e;
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

/** Push slot proxy to FeedFlow — direct engine URL first on cloud (Vercel API may lack WSAF_BRIDGE_URL). */
export async function syncSlotProxyToEngine(slot, proxyUrl) {
  if (!proxyUrl) throw new Error('proxyUrl required');
  if (!isLocalBridge()) {
    try {
      return await postLocalSlotProxy(slot, proxyUrl);
    } catch {
      const { data } = await api.post(`/bridge/slots/${slot}/proxy`, { proxyUrl });
      return data;
    }
  }
  try {
    const { data } = await api.post(`/bridge/slots/${slot}/proxy`, { proxyUrl });
    return data;
  } catch {
    return postLocalSlotProxy(slot, proxyUrl);
  }
}

export async function syncSlotDisplayLabelToEngine(slot, body = {}) {
  if (!isLocalBridge()) {
    try {
      return await postLocalSlotDisplayLabel(slot, body);
    } catch {
      const { data } = await api.post(`/bridge/slots/${slot}/display-label`, body);
      return data;
    }
  }
  try {
    const { data } = await api.post(`/bridge/slots/${slot}/display-label`, body);
    return data;
  } catch {
    return postLocalSlotDisplayLabel(slot, body);
  }
}

export async function getFeedingAudit(limit = 0) {
  // Never send limit=0 to the engine — older builds return an empty page.
  const params = limit > 0 ? { limit } : { limit: 100000 };
  const fromApi = await tryApi(() => api.get('/bridge/audit', { params }));
  if (fromApi) {
    return { ...fromApi, entries: fromApi.entries || [] };
  }
  try {
    const local = await fetchLocalFeedingAudit(limit);
    return { ...local, entries: local?.entries || [] };
  } catch {
    return { ok: false, reachable: false, entries: [] };
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
