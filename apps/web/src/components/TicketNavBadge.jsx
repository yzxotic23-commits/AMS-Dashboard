import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { useTickets } from '../hooks/useTickets';
import { pendingOperatorTickets, pendingBusinessConfirmTickets } from '../lib/ticket-pending';
import { profileStaffScope, accountInStaffScope } from '../lib/account-staff';

/** Sidebar count: operator IP review, or business confirm-live. */
export default function TicketNavBadge() {
  const { profile } = useAuth();
  const { site } = useSite();
  const isBusiness = profile?.role === 'business';
  const canSee = isBusiness || profile?.role === 'admin' || profile?.role === 'operator';
  const staffScope = useMemo(() => profileStaffScope(profile), [profile]);
  const { data: tickets = [] } = useTickets(site, { enabled: canSee });

  const count = useMemo(() => {
    if (!canSee) return 0;
    const rows = isBusiness
      ? pendingBusinessConfirmTickets(tickets, site)
      : pendingOperatorTickets(tickets, site);
    if (!staffScope) return rows.length;
    return rows.filter((t) => accountInStaffScope(t, staffScope)).length;
  }, [tickets, canSee, isBusiness, site, staffScope]);

  if (!count) return null;
  const label = count > 99 ? '99+' : count;
  return (
    <span
      className="hub-nav-badge ml-auto shrink-0"
      aria-label={isBusiness
        ? `${count} tickets awaiting confirm`
        : `${count} delivery tickets`}
    >
      {label}
    </span>
  );
}
