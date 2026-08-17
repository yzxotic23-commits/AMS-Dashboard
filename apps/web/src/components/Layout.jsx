import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { getSiteStripMessage, SITE_STRIP_PATHS } from '../lib/sites';
import { operatorSiteKey, siteOptionsForProfile } from '../lib/operator-scope';
import { homePathForRole, isPathAllowedForRole } from '../lib/role-access';
import { readSidebarOpenMap, writeSidebarOpenMap } from '../lib/sidebar-prefs';
import { useScrollRevealScrollbar } from '../hooks/useScrollRevealScrollbar';
import { pathInGroup } from './SidebarNavGroup';
import { useOptionalGovernanceDate } from '../context/GovernanceDateContext';
import SiteSwitcher from './SiteSwitcher';
import GovernanceDateControls from './GovernanceDateControls';
import AppSidebar from './AppSidebar';
import EngineBackgroundSync from './EngineBackgroundSync';
import EngineLogoutWatcher from './EngineLogoutWatcher';
import DisconnectBell from './DisconnectBell';
import TicketBell from './TicketBell';

/** AMS bridge sync only on pages that explicitly use FeedFlow engine — not global. */
const AMS_BRIDGE_SYNC_PATHS = [
  '/governance',
  '/audit',
  '/feedflow',
  '/link',
  '/nurturing',
  '/recovery',
];

const NAV_SECTIONS = [
  { section: 'OPERATOR ACTIONS', collapsible: true, items: [
    { to: '/' }, { to: '/register' }, { to: '/link' }, { to: '/nurturing' }, { to: '/recovery' },
  ]},
  { section: 'RESOURCE MGMT', collapsible: true, items: [{ to: '/ips' }, { to: '/sims' }] },
  { section: 'SETTINGS', collapsible: true, items: [{ to: '/settings' }, { to: '/settings/users' }] },
  { section: 'DELIVERY / DATA', collapsible: true, items: [
    { to: '/tickets' }, { to: '/governance' }, { to: '/audit' },
  ]},
];

const SITE_STRIP_CLASS = {
  all: 'site-context-strip site-context-strip--all',
  my: 'site-context-strip site-context-strip--my',
  pp: 'site-context-strip site-context-strip--pp',
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
    <div className="flex h-screen overflow-hidden bg-ams-sidebar">
      <EngineLogoutWatcher />
      {amsBridgeSync ? <EngineBackgroundSync /> : null}
      <AppSidebar
        profile={profile}
        pathname={location.pathname}
        openMap={openMap}
        initialOpenMap={initialOpenRef.current}
        onGroupToggle={setGroupOpen}
        onSignOut={handleSignOut}
      />

      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-ams-canvas">
        <header className="app-header-sticky w-full shrink-0 bg-ams-canvas">
          <div className="app-gutter app-header-toolbar pt-4 pb-3">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <div aria-hidden="true" />
              <div className="header-toolbar-center">
                <SiteSwitcher />
                {isGovernance && <GovernanceDateControls />}
              </div>
              <div className="flex items-center justify-end gap-3">
                <TicketBell />
                <DisconnectBell />
                <div className="header-user">
                  <div className="header-user-avatar">{initials}</div>
                  <span className="header-user-name">
                    {profile?.full_name || profile?.username || profile?.email}
                  </span>
                </div>
              </div>
            </div>
          </div>
          {showSiteBar && (
            <div className={SITE_STRIP_CLASS[site]} role="status">
              <div className="site-context-strip-inner">
                <strong>Current Site: {siteBar.label}</strong>
                <span>{siteBar.sub}</span>
              </div>
            </div>
          )}
        </header>

        <div
          ref={scrollPaneRef}
          className="main-scroll-pane flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden bg-ams-canvas"
        >
          <main className="flex w-full min-w-0 flex-1 flex-col bg-ams-canvas">
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
      </div>
    </div>
  );
}
