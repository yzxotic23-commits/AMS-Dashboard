export const SUPPLY_LABELS = {
  REGISTERING: 'Registering',
  NURTURING: 'Nurturing Pool',
  AVAILABLE: 'Standby Pool',
  IN_USE: 'In Business Use',
};

export const SUPPLY_TARGETS = {
  // AVAILABLE (Standby Pool) is count-only on Governance — target not used for alerts.
  all: { REGISTERING: 50, NURTURING: 240, IN_USE: 512 },
  my: { REGISTERING: 30, NURTURING: 140, IN_USE: 300 },
  pp: { REGISTERING: 20, NURTURING: 100, IN_USE: 212 },
};

export function supplyTargetFor(siteKey, status) {
  const sk = siteKey === 'my' || siteKey === 'pp' ? siteKey : 'all';
  return SUPPLY_TARGETS[sk]?.[status] ?? SUPPLY_TARGETS.all[status] ?? 0;
}
