import { createContext, useContext, useMemo, useState } from 'react';
import { SITES } from '../lib/sites';

const SiteContext = createContext(null);

export function SiteProvider({ children }) {
  const [site, setSite] = useState('all');

  const value = useMemo(() => ({
    site,
    setSite,
    sites: SITES,
  }), [site]);

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used within SiteProvider');
  return ctx;
}
