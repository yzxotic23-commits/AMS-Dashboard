const OPEN_KEY = 'ams-sidebar-open';
const SCROLL_KEY = 'ams-sidebar-scroll';
const COLLAPSED_KEY = 'ams-sidebar-collapsed';

export function readSidebarCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function readSidebarOpenMap() {
  try {
    return JSON.parse(sessionStorage.getItem(OPEN_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writeSidebarOpenMap(map) {
  try {
    sessionStorage.setItem(OPEN_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function readSidebarScrollTop() {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeSidebarScrollTop(top) {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(Math.round(top)));
  } catch {
    /* ignore */
  }
}
