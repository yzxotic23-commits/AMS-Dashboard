import { useAutoBanFromFeeding } from '../hooks/useAutoBanFromFeeding';
import { useAutoGraduateNurturing } from '../hooks/useAutoGraduateNurturing';
import { useReleaseStaleEngineSlots } from '../hooks/useReleaseStaleEngineSlots';

/** Background engine sync — ban detect, free stale slots (FeedFlow pages).
 *  Logout health sync runs globally via EngineLogoutWatcher. */
export default function EngineBackgroundSync() {
  useAutoBanFromFeeding();
  useAutoGraduateNurturing();
  useReleaseStaleEngineSlots();
  return null;
}
