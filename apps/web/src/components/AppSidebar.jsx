import { memo, useEffect, useRef } from 'react';
import { LogOut } from 'lucide-react';
import {
  LayoutGrid, Plus, Clock, RotateCcw, Globe, CreditCard, Table2,
  Ticket, LineChart, ScrollText, Zap, MessageSquare, Users,
} from 'lucide-react';
import { readSidebarScrollTop, writeSidebarScrollTop } from '../lib/sidebar-prefs';
import SidebarNavGroup, { pathInGroup } from './SidebarNavGroup';

const NAV = [
  { section: 'FEEDING ENGINE', collapsible: false, items: [
    { to: '/feedflow', icon: MessageSquare, label: 'FeedFlow', tag: 'Beta' },
  ]},
  { section: 'OPERATOR ACTIONS', collapsible: true, items: [
    { to: '/', icon: LayoutGrid, label: 'Control Center', end: true, badge: 'hub' },
    { to: '/register', icon: Plus, label: 'Register' },
    { to: '/link', icon: Zap, label: 'Activation' },
    { to: '/nurturing', icon: Clock, label: 'Nurturing' },
    { to: '/recovery', icon: RotateCcw, label: 'Account Recovery' },
  ]},
  { section: 'RESOURCE MGMT', collapsible: true, items: [
    { to: '/ips', icon: Globe, label: 'IP Ledger' },
    { to: '/sims', icon: CreditCard, label: 'SIM Card Ledger' },
  ]},
  { section: 'LOOKUP', collapsible: false, items: [
    { to: '/accounts', icon: Table2, label: 'Resource Ledger' },
  ]},
  { section: 'DELIVERY / DATA', collapsible: true, items: [
    { to: '/tickets', icon: Ticket, label: 'Business Self-Service Delivery' },
    { to: '/governance', icon: LineChart, label: 'Dashboard (Governance)' },
    { to: '/audit', icon: ScrollText, label: 'Audit Log' },
  ]},
];

const USER_MGMT_ITEM = {
  to: '/settings/users',
  icon: Users,
  label: 'User management',
};

function buildNav(profile) {
  return NAV.map((group) => {
    if (group.section !== 'RESOURCE MGMT' || profile?.role !== 'admin') return group;
    return {
      ...group,
      items: [...group.items, USER_MGMT_ITEM],
    };
  });
}

function groupIsOpen(section, items, pathname, openMap) {
  if (pathInGroup(items, pathname)) return true;
  return openMap[section] === true;
}

function AppSidebar({ pathname, openMap, initialOpenMap, onGroupToggle, onSignOut, profile }) {
  const nav = buildNav(profile);
  const navRef = useRef(null);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const saved = readSidebarScrollTop();
    if (saved != null) el.scrollTop = saved;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => writeSidebarScrollTop(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <aside className="sidebar-shell flex h-full w-[var(--ams-sidebar-w)] shrink-0 flex-col">
      <div className="flex items-center gap-3 px-7 pb-2 pt-8">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-ams-accent">
          <span className="text-sm font-bold text-white">A</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-normal text-white">AMS</div>
          <div className="truncate text-[11px] text-ams-sidebar-text">Account Management</div>
        </div>
      </div>

      <nav ref={navRef} className="sidebar-nav min-h-0 flex-1 px-5 py-4">
        {nav.map((group) => (
          <SidebarNavGroup
            key={group.section}
            section={group.section}
            items={group.items}
            collapsible={group.collapsible}
            pathname={pathname}
            open={group.collapsible
              ? groupIsOpen(group.section, group.items, pathname, openMap)
              : undefined}
            onToggle={group.collapsible
              ? (next) => onGroupToggle(group.section, next)
              : undefined}
            instant={group.collapsible && (
              initialOpenMap[group.section] === true
              || pathInGroup(group.items, pathname)
            )}
          />
        ))}
      </nav>

      <div className="sidebar-footer shrink-0">
        <button type="button" onClick={onSignOut} className="sidebar-footer-btn">
          <LogOut size={20} strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

export default memo(AppSidebar);
