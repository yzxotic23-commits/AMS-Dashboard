import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { getSiteStripMessage, SITE_STRIP_PATHS } from '../lib/sites';
import { pageHeadingFor } from '../lib/page-title';
import { operatorSiteKey, siteOptionsForProfile } from '../lib/operator-scope';
import { homePathForRole, isPathAllowedForRole } from '../lib/role-access';
import { readSidebarCollapsed, readSidebarOpenMap, writeSidebarCollapsed, writeSidebarOpenMap } from '../lib/sidebar-prefs';
import { useScrollRevealScrollbar } from '../hooks/useScrollRevealScrollbar';
import { pathInGroup } from './SidebarNavGroup';
import { useOptionalGovernanceDate } from '../context/GovernanceDateContext';
import SiteSwitcher from './SiteSwitcher';
import GovernanceDateControls from './GovernanceDateControls';
import AppSidebar from './AppSidebar';
import IconTooltip from './IconTooltip';
import EngineBackgroundSync from './EngineBackgroundSync';
import EngineLogoutWatcher from './EngineLogoutWatcher';
import DisconnectBell from './DisconnectBell';
import TicketBell from './TicketBell';
import BusinessNoticeBell from './BusinessNoticeBell';
import { PageHeaderPillsProvider } from './PageHeaderPills';

/** AMS bridge sync only on pages that explicitly use FeedFlow engine — not global. */
const AMS_BRIDGE_SYNC_PATHS = [
  '/governance',
  '/audit',
  '/feedflow',
  '/link',
  '/nurturing',
  '/recovery',
];

/** Pages whose data is not split by site — the site switcher would do nothing there. */
const SITE_SWITCHER_HIDDEN_PATHS = ['/telegram-otp'];

const NAV_SECTIONS = [
  { section: 'OPERATOR ACTIONS', collapsible: true, items: [
    { to: '/' }, { to: '/register' }, { to: '/link' }, { to: '/nurturing' }, { to: '/recovery' },
  ]},
  { section: 'RESOURCE MGMT', collapsible: true, items: [{ to: '/ips' }, { to: '/sims' }] },
  { section: 'SETTINGS', collapsible: true, items: [{ to: '/settings' }, { to: '/settings/users' }, { to: '/settings/access' }, { to: '/offboarding' }] },
  { section: 'DELIVERY / DATA', collapsible: true, items: [
    { to: '/tickets' }, { to: '/governance' }, { to: '/audit' },
  ]},
];

const SITE_CHIP_CLASS = {
  all: 'site-context-chip site-context-chip--all',
  my: 'site-context-chip site-context-chip--my',
  pp: 'site-context-chip site-context-chip--pp',
};

export default function Layout({ authBooting = false }) {
  const { profile, signOut } = useAuth();
  const { site, setSite } = useSite();
  const navigate = useNavigate();
  const location = useLocation();
  const governanceDate = useOptionalGovernanceDate();
  const isGovernance = location.pathname === '/governance';
  const siteBar = getSiteStripMessage(location.pathname, site, isGovernance ? governanceDate : null);
  const showSiteBar = SITE_STRIP_PATHS.includes(location.pathname);
  const scrollPaneRef = useScrollRevealScrollbar();
  const initialOpenRef = useRef(readSidebarOpenMap());
  const [openMap, setOpenMap] = useState(() => initialOpenRef.current);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [headerPillsEl, setHeaderPillsEl] = useState(null);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return;
      const el = e.target;
      if (el instanceof HTMLElement) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;
      }
      e.preventDefault();
      toggleSidebarCollapsed();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebarCollapsed]);

  const setGroupOpen = useCallback((section, open) => {
    setOpenMap((prev) => {
      const next = { ...prev, [section]: open };
      writeSidebarOpenMap(next);
      return next;
    });
  }, []);

  const siteSeededFor = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;
    const options = siteOptionsForProfile(profile);
    if (options.length === 1) {
      setSite(options[0]);
      siteSeededFor.current = profile.id;
      return;
    }
    // Multi-site: seed once per login; keep manual All / MY / PP switches after that.
    if (siteSeededFor.current === profile.id) return;
    setSite(operatorSiteKey(profile));
    siteSeededFor.current = profile.id;
  }, [profile?.id, profile?.role, profile?.site_key, setSite]);

  useEffect(() => {
    NAV_SECTIONS.forEach((group) => {
      if (!group.collapsible) return;
      if (!pathInGroup(group.items, location.pathname)) return;
      setOpenMap((prev) => {
        if (prev[group.section] === true) return prev;
        const next = { ...prev, [group.section]: true };
        writeSidebarOpenMap(next);
        return next;
      });
    });
  }, [location.pathname]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/login');
  }, [signOut, navigate]);

  const initials = (profile?.full_name || profile?.email || 'U').charAt(0).toUpperCase();
  const amsBridgeSync = AMS_BRIDGE_SYNC_PATHS.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  );

  if (profile?.role === 'business' && !isPathAllowedForRole(location.pathname, 'business')) {
    return <Navigate to={homePathForRole('business')} replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ams-canvas">
      <EngineLogoutWatcher />
      {amsBridgeSync ? <EngineBackgroundSync /> : null}
      <div className={`sidebar-rail${sidebarCollapsed ? ' sidebar-rail--collapsed' : ''}`}>
        <AppSidebar
          profile={profile}
          pathname={location.pathname}
          openMap={openMap}
          initialOpenMap={initialOpenRef.current}
          onGroupToggle={setGroupOpen}
          onSignOut={handleSignOut}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
        />
      </div>

      <div className="app-stage">
        <PageHeaderPillsProvider slot={headerPillsEl}>
        <header className="app-header-sticky w-full shrink-0">
          <div className="app-gutter app-header-toolbar pt-4 pb-3">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <div className="app-header-lead">
                <h1 className="app-header-title">{pageHeadingFor(location.pathname, profile?.role)}</h1>
                <div ref={setHeaderPillsEl} className="app-header-pills" />
              </div>
              <div className="header-toolbar-center">
                {!SITE_SWITCHER_HIDDEN_PATHS.includes(location.pathname) && <SiteSwitcher />}
                {showSiteBar && (
                  <IconTooltip label={siteBar.sub} rich>
                    <span className={SITE_CHIP_CLASS[site] || SITE_CHIP_CLASS.all} role="status">
                      {site === 'all' ? 'All sites' : 'This site only'}
                    </span>
                  </IconTooltip>
                )}
                {isGovernance && <GovernanceDateControls />}
              </div>
              <div className="flex items-center justify-end gap-3">
                <TicketBell />
                <DisconnectBell />
                <BusinessNoticeBell />
                <div className="header-user">
                  <div className="header-user-avatar">{initials}</div>
                  <span className="header-user-name">
                    {profile?.full_name || profile?.username || profile?.email}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div
          ref={scrollPaneRef}
          className="main-scroll-pane flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden"
        >
          <main className="flex w-full min-w-0 flex-1 flex-col">
            <div className="content-column page-shell w-full flex-1">
              {authBooting ? (
                <div className="flex flex-1 items-center justify-center py-24">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-ams-line border-t-ams-accent" />
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
        </div>
        </PageHeaderPillsProvider>
      </div>
    </div>
  );
}
