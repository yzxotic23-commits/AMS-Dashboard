/** Tickets awaiting operator IP review (submitted, not rejected). */
export function pendingOperatorTickets(tickets, site = 'all') {
  return (tickets || [])
    .filter((t) => {
      if (t.delivery_stage !== 'submitted') return false;
      if (t.reject_reason) return false;
      if (site !== 'all' && t.site_key && t.site_key !== site) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = new Date(a.submitted_at || a.created_at || 0).getTime();
      const tb = new Date(b.submitted_at || b.created_at || 0).getTime();
      return tb - ta;
    });
}

/** Tickets awaiting business confirm live (operator already went live). */
export function pendingBusinessConfirmTickets(tickets, site = 'all') {
  return (tickets || [])
    .filter((t) => {
      if (t.delivery_stage !== 'posted') return false;
      if (site !== 'all' && t.site_key && t.site_key !== site) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = new Date(a.in_progress_at || a.updated_at || a.submitted_at || a.created_at || 0).getTime();
      const tb = new Date(b.in_progress_at || b.updated_at || b.submitted_at || b.created_at || 0).getTime();
      return tb - ta;
    });
}
