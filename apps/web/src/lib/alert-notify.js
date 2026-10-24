/** Hardened in-app + desktop alerts (tickets / disconnect). */

let sharedAudioCtx = null;
let audioUnlockBound = false;
let pendingChime = false;
let audioUnlocked = false;
const BASE_TITLE_FALLBACK = 'AMS';
let baseTitle = null;
let titleFlashTimer = null;

/** Page title to show when no alert is flashing. */
export function setBaseTitle(title) {
  baseTitle = title;
  if (typeof document !== 'undefined' && !titleFlashTimer) document.title = title;
}

function rememberBaseTitle() {
  if (typeof document === 'undefined') return BASE_TITLE_FALLBACK;
  if (!baseTitle) {
    const current = document.title || BASE_TITLE_FALLBACK;
    baseTitle = current.includes('· AMS') || current.startsWith('(') || current.startsWith('⚠')
      ? BASE_TITLE_FALLBACK
      : current;
  }
  return baseTitle;
}

function getAudioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export function getSharedAudioContext() {
  const Ctx = getAudioContextClass();
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  if (sharedAudioCtx.state === 'running') audioUnlocked = true;
  return sharedAudioCtx;
}

function flushPendingChime() {
  if (!pendingChime) return;
  pendingChime = false;
  playTicketAlertSound();
}

async function unlockAudioFromGesture() {
  try {
    const ctx = getSharedAudioContext();
    if (ctx?.state === 'suspended') await ctx.resume();
    if (ctx?.state === 'running') audioUnlocked = true;
  } catch {
    /* autoplay still blocked */
  }
  if (audioUnlocked) flushPendingChime();
}

/** Call once so later chimes work even after tab was backgrounded. Bind as early as main.jsx (login click counts). */
export function bindAudioUnlock() {
  if (typeof window === 'undefined' || audioUnlockBound) return;
  audioUnlockBound = true;
  const unlock = () => {
    unlockAudioFromGesture();
    requestNotificationPermissionOnGesture();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('mousedown', unlock, { capture: true });
  window.addEventListener('click', unlock, { capture: true });
  window.addEventListener('touchstart', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) unlockAudioFromGesture();
  });
}

function playTone(ctx, { freq, at, dur, type = 'triangle', peak = 0.2 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.05, dur));
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

/** Louder triple chime — queues until AudioContext is running (after any user gesture). */
export function playTicketAlertSound() {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state !== 'running') {
      pendingChime = true;
      if (sharedAudioCtx?.state === 'suspended') {
        sharedAudioCtx.resume().then(() => {
          if (sharedAudioCtx?.state === 'running') {
            audioUnlocked = true;
            flushPendingChime();
          }
        }).catch(() => {});
      }
      return false;
    }
    const ctx = sharedAudioCtx;
    playTone(ctx, { freq: 523.25, at: 0, dur: 0.2, peak: 0.22 });
    playTone(ctx, { freq: 659.25, at: 0.14, dur: 0.26, peak: 0.24 });
    playTone(ctx, { freq: 830.61, at: 0.3, dur: 0.36, peak: 0.2 });
    return true;
  } catch {
    pendingChime = true;
    return false;
  }
}

let permissionAsked = false;
let swRegisterPromise = null;

/** Register the alert service worker so Chrome can show background notifications. */
export function registerAlertWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!swRegisterPromise) {
    swRegisterPromise = navigator.serviceWorker.register('/sw.js').catch(() => null);
  }
  return swRegisterPromise;
}

export function notificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function ensureNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') {
    registerAlertWorker();
    return 'granted';
  }
  if (Notification.permission === 'denied') return 'denied';
  try {
    permissionAsked = true;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') registerAlertWorker();
    return perm;
  } catch {
    return Notification.permission;
  }
}

/** Ask once on a user gesture (login click / first tap) so Chrome alerts work later. */
export function requestNotificationPermissionOnGesture() {
  if (permissionAsked) return;
  if (notificationPermission() !== 'default') {
    if (notificationPermission() === 'granted') registerAlertWorker();
    return;
  }
  permissionAsked = true;
  ensureNotificationPermission();
}

/**
 * Desktop notification — prefers the service worker so Chrome still shows
 * it when the AMS tab is in the background or another window is focused.
 */
export function showDesktopNotification({
  title,
  body,
  tag = 'ams-ticket',
  url = '/tickets',
  onClick,
}) {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;
  const options = {
    body,
    tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url },
  };

  const viaConstructor = () => {
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        onClick?.();
        n.close();
      };
      return n;
    } catch {
      return null;
    }
  };

  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    Promise.resolve(registerAlertWorker())
      .then((reg) => (reg ? reg.showNotification(title, options) : viaConstructor()))
      .catch(() => viaConstructor());
    return true;
  }
  return viaConstructor();
}

/** Flash document title while there are pending alerts and tab is hidden / always when count > 0. */
export function setPendingTitleFlash(count, label = 'ticket') {
  if (typeof document === 'undefined') return;
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  if (!count) {
    document.title = rememberBaseTitle();
    return;
  }
  rememberBaseTitle();
  const alertTitle = `(${count}) ${label}${count === 1 ? '' : 's'} · AMS`;
  let flip = false;
  document.title = alertTitle;
  titleFlashTimer = setInterval(() => {
    flip = !flip;
    document.title = flip ? `⚠ ${alertTitle}` : alertTitle;
  }, 1400);
}

export function clearPendingTitleFlash() {
  if (typeof document === 'undefined') return;
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  document.title = rememberBaseTitle();
}
