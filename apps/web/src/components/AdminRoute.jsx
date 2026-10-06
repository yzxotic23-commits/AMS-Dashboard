import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../lib/role-access';

/** Admin-only route; `allow` can admit specific non-admin profiles (e.g. offboarding permission). */
export default function AdminRoute({ children, allow }) {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ams-line border-t-ams-accent" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (profile?.role !== 'admin' && !allow?.(profile)) {
    return <Navigate to={homePathForRole(profile?.role)} replace />;
  }

  return children;
}
