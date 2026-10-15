import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { setBaseTitle } from './lib/alert-notify';
import { pageTitleFor } from './lib/page-title';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import CommandCenterPage from './pages/CommandCenterPage';
import GovernancePage from './pages/GovernancePage';
import AccountsPage from './pages/AccountsPage';
import RegisterPage from './pages/RegisterPage';
import IpsPage from './pages/IpsPage';
import SimsPage from './pages/SimsPage';
import AuditLogPage from './pages/AuditLogPage';
import DevicesPage from './pages/DevicesPage';
import ActivationDeskPage from './pages/ActivationDeskPage';
import RecoveryPage from './pages/RecoveryPage';
import TelegramOtpPage from './pages/TelegramOtpPage';
import FeedFlowPage from './pages/FeedFlowPage';
import TicketsPage from './pages/TicketsPage';
import UserManagementPage from './pages/settings/UserManagementPage';
import SettingsPage from './pages/settings/SettingsPage';
import NetworkAccessPage from './pages/settings/NetworkAccessPage';
import OffboardingPage from './pages/OffboardingPage';
import AdminRoute from './components/AdminRoute';
import { homePathForRole } from './lib/role-access';

function ProtectedShell() {
  const { session, profile, loading } = useAuth();
  if (!loading && !session) return <Navigate to="/login" replace />;
  // Wait for profile so Business nav doesn't flash the full operator sidebar.
  const authBooting = loading || Boolean(session && !profile);
  return <Layout authBooting={authBooting} />;
}

function HomeRedirect() {
  const { profile, loading } = useAuth();
  if (loading && !profile) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ams-line border-t-ams-accent" />
      </div>
    );
  }
  if (profile?.role === 'business') {
    return <Navigate to={homePathForRole('business')} replace />;
  }
  return <CommandCenterPage />;
}

function LoginRedirect() {
  const { profile } = useAuth();
  return <Navigate to={homePathForRole(profile?.role)} replace />;
}

export default function App() {
  const { session, profile } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => {
    setBaseTitle(pageTitleFor(pathname, profile?.role));
  }, [pathname, profile?.role]);

  return (
    <Routes>
      <Route path="/login" element={session ? <LoginRedirect /> : <LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route index element={<HomeRedirect />} />
        <Route path="governance" element={<GovernancePage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="activation" element={<Navigate to="/register" replace />} />
        <Route path="link" element={<ActivationDeskPage />} />
        <Route path="nurturing" element={<Navigate to="/link?tab=nurturing" replace />} />
        <Route path="recovery" element={<RecoveryPage />} />
        <Route
          path="telegram-otp"
          element={(
            <AdminRoute allow={(p) => p?.role === 'operator' || p?.role === 'business'}>
              <TelegramOtpPage />
            </AdminRoute>
          )}
        />
        <Route path="feedflow" element={<FeedFlowPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="sims" element={<SimsPage />} />
        <Route path="ips" element={<IpsPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="supply" element={<Navigate to="/governance" replace />} />
        <Route path="phone-sync" element={<Navigate to="/sims" replace />} />
        <Route path="ip-gate" element={<Navigate to="/ips" replace />} />
        <Route path="audit" element={<AuditLogPage />} />
        <Route
          path="offboarding"
          element={(
            <AdminRoute allow={(p) => p?.can_offboard === true}>
              <OffboardingPage />
            </AdminRoute>
          )}
        />
        <Route
          path="settings"
          element={(
            <AdminRoute>
              <SettingsPage />
            </AdminRoute>
          )}
        />
        <Route
          path="settings/users"
          element={(
            <AdminRoute>
              <UserManagementPage />
            </AdminRoute>
          )}
        />
        <Route
          path="settings/access"
          element={(
            <AdminRoute>
              <NetworkAccessPage />
            </AdminRoute>
          )}
        />
        <Route
          path="team"
          element={(
            <AdminRoute>
              <Navigate to="/settings/users" replace />
            </AdminRoute>
          )}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
