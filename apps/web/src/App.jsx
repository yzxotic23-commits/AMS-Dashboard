import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
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
import FeedFlowPage from './pages/FeedFlowPage';
import TicketsPage from './pages/TicketsPage';
import UserManagementPage from './pages/settings/UserManagementPage';
import SettingsPage from './pages/settings/SettingsPage';
import AdminRoute from './components/AdminRoute';

function ProtectedShell() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Navigate to="/login" replace />;
  return <Layout authBooting={loading && !session} />;
}

export default function App() {
  const { session } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route index element={<CommandCenterPage />} />
        <Route path="governance" element={<GovernancePage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="activation" element={<Navigate to="/register" replace />} />
        <Route path="link" element={<ActivationDeskPage />} />
        <Route path="nurturing" element={<Navigate to="/link?tab=nurturing" replace />} />
        <Route path="recovery" element={<RecoveryPage />} />
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
