import { useAutoBanFromFeeding } from '../hooks/useAutoBanFromFeeding';
import { useAutoGraduateNurturing } from '../hooks/useAutoGraduateNurturing';
import { useEngineHealthSync } from '../hooks/useEngineHealthSync';

/** Background engine sync — ban detect, auto graduate, health check. */
export default function EngineBackgroundSync() {
  useAutoBanFromFeeding();
  useAutoGraduateNurturing();
  useEngineHealthSync();
  return null;
}
