import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

function engineUrl() {
  const fromEnv = import.meta.env.VITE_WSAF_BRIDGE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://127.0.0.1:47821';
}

let socket;

export function getWsafSocket() {
  if (!socket) {
    socket = io(engineUrl(), { transports: ['websocket', 'polling'], autoConnect: true });
  }
  return socket;
}

export function useWsafSocket(event, handler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;
    const s = getWsafSocket();
    const wrapped = (payload) => handlerRef.current(payload);
    s.on(event, wrapped);
    return () => s.off(event, wrapped);
  }, [event, enabled]);
}
