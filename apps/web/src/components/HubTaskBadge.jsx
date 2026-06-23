import { useHubCounts } from '../hooks/useHubCounts';
import { useSite } from '../context/SiteContext';

export default function HubTaskBadge() {
  const { site } = useSite();
  const { total } = useHubCounts(site);
  if (!total) return null;
  const label = total > 99 ? '99+' : total;
  return (
    <span className="hub-nav-badge ml-auto shrink-0" aria-label={`${total} pending tasks`}>
      {label}
    </span>
  );
}
