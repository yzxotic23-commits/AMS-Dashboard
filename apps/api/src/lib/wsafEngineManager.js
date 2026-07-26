import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Local auto-start uses nested WSAF/ (working native modules). Railway uses the BO repo. */
const DEFAULT_WSAF_ROOT = path.resolve(__dirname, '../../../../../WSAF');

let child = null;
/** idle | starting | ready | failed | external | disabled */
let bootState = 'idle';

function wsafRoot() {
  return process.env.WSAF_ROOT || DEFAULT_WSAF_ROOT;
}

function autoStartEnabled() {
  if (process.env.VERCEL) return false;
  const v = (process.env.WSAF_AUTO_START ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0';
}

function bridgeBase() {
  return (process.env.WSAF_BRIDGE_URL || 'http://127.0.0.1:47821').replace(/\/$/, '');
}

async function probeBridge() {
  try {
    const res = await fetch(`${bridgeBase()}/api/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForBridge(maxMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await probeBridge()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function getWsafBootStatus() {
  return {
    autoStart: autoStartEnabled(),
    state: bootState,
    managed: Boolean(child && !child.killed),
    pid: child?.pid ?? null,
    wsafRoot: wsafRoot(),
  };
}

export async function startWsafEngine() {
  if (!autoStartEnabled()) {
    bootState = 'disabled';
    console.log('[AMS] FeedFlow auto-start disabled (WSAF_AUTO_START=false)');
    return false;
  }

  if (await probeBridge()) {
    bootState = 'external';
    console.log('[AMS] FeedFlow engine already running');
    return true;
  }

  if (child && !child.killed) {
    const ok = await waitForBridge(15_000);
    if (ok) {
      bootState = 'ready';
      return true;
    }
    stopWsafEngine();
  }

  const root = wsafRoot();
  const webJs = path.join(root, 'web.js');
  if (!fs.existsSync(webJs)) {
    bootState = 'failed';
    console.error(`[AMS] FeedFlow not found at ${root} — set WSAF_ROOT or install WSAF alongside AMS Project`);
    return false;
  }

  bootState = 'starting';
  console.log(`[AMS] Starting FeedFlow engine from ${root}`);

  child = spawn(process.execPath, ['web.js'], {
    cwd: root,
    env: { ...process.env, DESKTOP_FEEDING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) console.log(`[WSAF] ${line}`);
    }
  });
  child.stderr?.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) console.error(`[WSAF] ${line}`);
    }
  });

  child.on('exit', (code, signal) => {
    const wasManaged = child != null;
    child = null;
    if (bootState === 'external') return;
    if (wasManaged && bootState === 'ready') {
      bootState = code === 0 ? 'idle' : 'failed';
      console.warn(`[AMS] FeedFlow engine exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    } else if (bootState === 'starting') {
      bootState = 'failed';
    }
  });

  const ok = await waitForBridge();
  if (ok) {
    bootState = 'ready';
    console.log(`[AMS] FeedFlow engine ready · ${bridgeBase()}`);
    return true;
  }
  bootState = 'failed';
  console.error('[AMS] FeedFlow engine did not respond in time');
  return false;
}

/** Probe engine; start child process if down (used before link/connect). */
export async function ensureWsafEngineReady() {
  if (await probeBridge()) return true;
  console.log('[AMS] FeedFlow engine offline — attempting start…');
  return startWsafEngine();
}

export function stopWsafEngine() {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  child = null;
  if (bootState !== 'external') bootState = 'idle';
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopWsafEngine();
  });
}
