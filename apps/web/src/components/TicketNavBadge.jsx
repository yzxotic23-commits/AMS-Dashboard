import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { useTickets } from '../hooks/useTickets';
import { pendingOperatorTickets } from '../lib/ticket-pending';

/** Sidebar count of delivery tickets awaiting operator review. */
export default function TicketNavBadge() {
  const { profile } = useAuth();
  const { site } = useSite();
  const canSee = profile?.role === 'admin' || profile?.role === 'operator';
  const { data: tickets = [] } = useTickets(site, { enabled: canSee });

  const count = useMemo(
    () => (canSee ? pendingOperatorTickets(tickets, site).length : 0),
    [tickets, canSee, site],
  );

  if (!count) return null;
  const label = count > 99 ? '99+' : count;
  return (
    <span className="hub-nav-badge ml-auto shrink-0" aria-label={`${count} delivery tickets`}>
      {label}
    </span>
  );
}
