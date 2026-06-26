import { useHubCounts } from '../hooks/useHubCounts';
import { useSite } from '../context/SiteContext';

/** Prepared numbers that need registration today (per site filter). */
export default function RegisterNavBadge() {
  const { site } = useSite();
  const { reg } = useHubCounts(site);
  if (!reg) return null;
  const label = reg > 99 ? '99+' : reg;
  return (
    <span className="hub-nav-badge ml-auto shrink-0" aria-label={`${reg} to register`}>
      {label}
    </span>
  );
}
