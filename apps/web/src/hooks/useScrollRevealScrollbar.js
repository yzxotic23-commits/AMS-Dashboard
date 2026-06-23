import { useCallback, useEffect, useRef } from 'react';

const IDLE_MS = 750;
const FADE_MS = 500;

/** Show overlay scrollbar while scrolling; smooth fade in/out after idle. */
export function useScrollRevealScrollbar() {
  const ref = useRef(null);
  const idleTimer = useRef(null);
  const fadeTimer = useRef(null);

  const clearTimers = useCallback(() => {
    clearTimeout(idleTimer.current);
    clearTimeout(fadeTimer.current);
  }, []);

  const reveal = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    clearTimers();
    el.classList.remove('main-scroll-pane--hiding');

    if (!el.classList.contains('main-scroll-pane--scrolling')) {
      el.classList.add('main-scroll-pane--scrolling');
    }

    idleTimer.current = setTimeout(() => {
      el.classList.add('main-scroll-pane--hiding');
      fadeTimer.current = setTimeout(() => {
        el.classList.remove('main-scroll-pane--scrolling', 'main-scroll-pane--hiding');
      }, FADE_MS);
    }, IDLE_MS);
  }, [clearTimers]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const events = ['scroll', 'wheel', 'touchmove'];
    events.forEach((name) => el.addEventListener(name, reveal, { passive: true }));

    return () => {
      clearTimers();
      events.forEach((name) => el.removeEventListener(name, reveal));
    };
  }, [reveal, clearTimers]);

  return ref;
}
