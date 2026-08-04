/**
 * Previously auto-moved NURTURING → AVAILABLE on day 7, which hid extended
 * nurture accounts from Activation & Nurturing (resource-team feedback).
 *
 * Graduation is now operator-driven via “Mark nurturing complete” so day 8+
 * accounts stay visible and keep accumulating nurturing days for Trust Score.
 *
 * Hook kept as a no-op so EngineBackgroundSync import stays stable.
 */
export function useAutoGraduateNurturing() {
  /* intentionally disabled — see NurturingPanels graduate() */
}
