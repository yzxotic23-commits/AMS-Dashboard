import { useAutoBanFromFeeding } from '../hooks/useAutoBanFromFeeding';
import { useAutoGraduateNurturing } from '../hooks/useAutoGraduateNurturing';
import { useEngineHealthSync } from '../hooks/useEngineHealthSync';
import { useReleaseStaleEngineSlots } from '../hooks/useReleaseStaleEngineSlots';

/** Background engine sync — ban detect, health check, free stale slots.
 *  Auto-graduate disabled: extended nurture stays on Nurturing until manual Ready. */
export default function EngineBackgroundSync() {
  useAutoBanFromFeeding();
  useAutoGraduateNurturing();
  useEngineHealthSync();
  useReleaseStaleEngineSlots();
  return null;
}
