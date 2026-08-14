import { NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import HubTaskBadge from './HubTaskBadge';
import RegisterNavBadge from './RegisterNavBadge';
import DisconnectNavBadge from './DisconnectNavBadge';
import TicketNavBadge from './TicketNavBadge';

function pathInGroup(items, pathname) {
  return items.some(({ to, end }) => {
    if (to === '/') return end ? pathname === '/' : pathname.startsWith('/');
    return pathname === to || pathname.startsWith(`${to}/`);
  });
}

function NavItem({ to, icon: Icon, label, end, badge, tag, nested }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `sidebar-link ${nested ? 'sidebar-link--nested' : ''} ${isActive ? 'sidebar-link-active' : ''}`
      }
    >
      <Icon size={nested ? 20 : 22} strokeWidth={1.75} className="shrink-0" />
      <span className="min-w-0 flex-1 leading-snug">{label}</span>
      {tag && <span className="sidebar-link-tag">{tag}</span>}
      {badge === 'hub' && <HubTaskBadge />}
      {badge === 'reg' && <RegisterNavBadge />}
      {badge === 'disconnect' && <DisconnectNavBadge />}
      {badge === 'tickets' && <TicketNavBadge />}
      {typeof badge === 'function' && badge() > 0 && (
        <span className="ml-auto shrink-0 rounded-full bg-ams-accent px-1.5 py-px text-[10px] font-semibold text-white">
          {badge()}
        </span>
      )}
    </NavLink>
  );
}

export default function SidebarNavGroup({
  section,
  items,
  collapsible,
  pathname,
  open = false,
  onToggle,
  instant = false,
}) {
  if (!collapsible) {
    return (
      <div className="sidebar-group">
        <div className="sidebar-section">{section}</div>
        {items.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={[
        'sidebar-group sidebar-group--submenu',
        open ? 'sidebar-group--open' : '',
        instant ? 'sidebar-group--instant' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className="sidebar-submenu-toggle"
        aria-expanded={open}
        onClick={() => onToggle?.(!open)}
      >
        <span className="sidebar-submenu-label">{section}</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={`sidebar-submenu-chevron${open ? ' sidebar-submenu-chevron--open' : ''}`}
          aria-hidden
        />
      </button>
      <div className="sidebar-submenu-items">
        {items.map((item) => (
          <NavItem key={item.to} {...item} nested />
        ))}
      </div>
    </div>
  );
}

export { pathInGroup };
