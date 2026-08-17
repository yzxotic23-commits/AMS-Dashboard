import { useEngineHealthSync } from '../hooks/useEngineHealthSync';
import { useAuth } from '../context/AuthContext';

/**
 * Always-on logout detector for operator/admin (any AMS page).
 * Kept separate from FeedFlow-only EngineBackgroundSync so Bryan gets
 * disconnect reports without needing to stay on /feedflow.
 */
export default function EngineLogoutWatcher() {
  const { profile } = useAuth();
  const canWatch = profile?.role === 'admin' || profile?.role === 'operator';
  if (!canWatch) return null;
  return <EngineLogoutWatcherInner />;
}

function EngineLogoutWatcherInner() {
  useEngineHealthSync();
  return null;
}
