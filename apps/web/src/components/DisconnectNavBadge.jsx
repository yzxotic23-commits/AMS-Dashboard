import { useMemo } from 'react';
import { useAllAccounts } from '../hooks/useOperatorAccounts';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';

/** Pending confirmation (keep-alive / business report) awaiting R&M. */
export default function DisconnectNavBadge() {
  const { profile } = useAuth();
  const { site } = useSite();
  const { data: accounts = [] } = useAllAccounts({
    enabled: profile?.role === 'admin' || profile?.role === 'operator',
  });

  const count = useMemo(() => (
    accounts.filter((a) => {
      if (!a.disconnect_report) return false;
      if (site === 'all') return true;
      return a.siteKey === site || a.siteKey === 'all';
    }).length
  ), [accounts, site]);

  if (!count) return null;
  const label = count > 99 ? '99+' : count;
  return (
    <span className="hub-nav-badge ml-auto shrink-0" aria-label={`${count} pending confirmation`}>
      {label}
    </span>
  );
}
