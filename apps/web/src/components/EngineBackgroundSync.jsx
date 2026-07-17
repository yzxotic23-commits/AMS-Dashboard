import { useAutoBanFromFeeding } from '../hooks/useAutoBanFromFeeding';
import { useAutoGraduateNurturing } from '../hooks/useAutoGraduateNurturing';
import { useEngineHealthSync } from '../hooks/useEngineHealthSync';
import { useReleaseStaleEngineSlots } from '../hooks/useReleaseStaleEngineSlots';

/** Background engine sync — ban detect, auto graduate, health check, free stale slots. */
export default function EngineBackgroundSync() {
  useAutoBanFromFeeding();
  useAutoGraduateNurturing();
  useEngineHealthSync();
  useReleaseStaleEngineSlots();
  return null;
}
