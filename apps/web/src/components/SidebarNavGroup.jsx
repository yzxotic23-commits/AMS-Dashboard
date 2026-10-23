import { NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import HubTaskBadge from './HubTaskBadge';
import RegisterNavBadge from './RegisterNavBadge';
import DisconnectNavBadge from './DisconnectNavBadge';
import TicketNavBadge from './TicketNavBadge';
import IconTooltip from './IconTooltip';

function pathInGroup(items, pathname) {
  return items.some(({ to, end }) => {
    if (to === '/') return end ? pathname === '/' : pathname.startsWith('/');
    return pathname === to || pathname.startsWith(`${to}/`);
  });
}

function NavItem({ to, icon: Icon, label, end, badge, tag, nested, collapsed }) {
  const link = (
    <NavLink
      to={to}
      end={end}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        [
          'sidebar-link',
          nested && !collapsed ? 'sidebar-link--nested' : '',
          collapsed ? 'sidebar-link--icon' : '',
          isActive ? 'sidebar-link-active' : '',
        ].filter(Boolean).join(' ')
      }
    >
      <Icon size={collapsed ? 22 : nested ? 20 : 22} strokeWidth={1.75} className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 leading-snug">{label}</span>}
      {!collapsed && tag && <span className="sidebar-link-tag">{tag}</span>}
      {badge === 'hub' && <HubTaskBadge />}
      {badge === 'reg' && <RegisterNavBadge />}
      {badge === 'disconnect' && <DisconnectNavBadge />}
      {badge === 'tickets' && <TicketNavBadge />}
      {!collapsed && typeof badge === 'function' && badge() > 0 && (
        <span className="ml-auto shrink-0 rounded-full bg-ams-accent px-1.5 py-px text-[10px] font-semibold text-white">
          {badge()}
        </span>
      )}
    </NavLink>
  );
  if (!collapsed) return link;
  return <IconTooltip label={tag ? `${label} · ${tag}` : label}>{link}</IconTooltip>;
}

export default function SidebarNavGroup({
  section,
  items,
  collapsible,
  pathname,
  open = false,
  onToggle,
  instant = false,
  collapsed = false,
}) {
  if (collapsed) {
    return (
      <div className="sidebar-group sidebar-group--collapsed">
        {items.map((item) => (
          <NavItem key={item.to} {...item} collapsed />
        ))}
      </div>
    );
  }

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
