/**
 * Account lifecycle state machine (Module 5)
 * Invalid transitions throw Error.
 */
export const ACCOUNT_STATUSES = [
  'REGISTERING', 'NURTURING', 'AVAILABLE', 'IN_USE',
  'LOGGED_OUT', 'BANNED', 'RECOVERING', 'RECYCLED',
];

export const VALID_TRANSITIONS = {
  REGISTERING: ['NURTURING', 'RECYCLED'],
  NURTURING: ['AVAILABLE', 'BANNED', 'RECYCLED'],
  // Standby / not-yet-scanned: R&M must still mark Ban or Restrict when the phone
  // shows a platform ban before Frontline requests the account again.
  AVAILABLE: ['IN_USE', 'NURTURING', 'RECYCLED', 'BANNED', 'LOGGED_OUT'],
  IN_USE: ['LOGGED_OUT', 'BANNED', 'AVAILABLE'],
  // BANNED allowed so R&M can confirm ban after engine auto-logout / disconnect report.
  LOGGED_OUT: ['NURTURING', 'RECOVERING', 'RECYCLED', 'BANNED', 'IN_USE', 'AVAILABLE'],
  BANNED: ['RECOVERING', 'RECYCLED'],
  RECOVERING: ['NURTURING', 'AVAILABLE', 'RECYCLED'],
  RECYCLED: [],
};

export function canTransition(from, to) {
  if (!from) return ACCOUNT_STATUSES.includes(to);
  const allowed = VALID_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`Invalid state transition: ${from || 'NEW'} → ${to}`);
    err.status = 422;
    throw err;
  }
}
