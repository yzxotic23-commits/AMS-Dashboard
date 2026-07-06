const DEFAULT_BRIDGE = 'http://127.0.0.1:47821';

export function wsafBridgeBase() {
  const raw = import.meta.env.VITE_WSAF_BRIDGE_URL || DEFAULT_BRIDGE;
  return raw.replace(/\/$/, '');
}

/** True when VITE_WSAF_BRIDGE_URL points at this machine (not Railway/cloud). */
export function isLocalBridge() {
  const base = wsafBridgeBase().toLowerCase();
  return base.includes('127.0.0.1') || base.includes('localhost');
}

export function bridgeEngineLabel() {
  return isLocalBridge() ? 'local FeedFlow engine' : 'FeedFlow cloud engine (Railway)';
}

/** Standalone FeedFlow console (new tab). */
export function wsafConsoleUrl() {
  return `${wsafBridgeBase()}/`;
}

/** Legacy embed URL — kept for reference; AMS no longer iframes the console. */
export function wsafEmbedUrl() {
  return `${wsafBridgeBase()}/?embed=ams`;
}
