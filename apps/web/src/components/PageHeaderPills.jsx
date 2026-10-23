import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

const SlotContext = createContext(null);

export function PageHeaderPillsProvider({ slot, children }) {
  return <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>;
}

export function PageHeaderPills({ children }) {
  const slot = useContext(SlotContext);
  if (!children || !slot) return null;
  return createPortal(children, slot);
}
