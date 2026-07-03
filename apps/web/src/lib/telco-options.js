/** Telco / carrier options — single list for all sites (MY + PP numbers may mix). */
export const TELCO_OPTIONS = [
  'Outsource',
  'Tunetalk',
  'Celcom',
  'Digi',
  'Maxis',
  'U Mobile',
  'Unifi',
  'Cellcard',
  'Metfone',
  'Smart',
];

export function telcoOptionsForSite() {
  return TELCO_OPTIONS;
}

export function defaultTelco() {
  return TELCO_OPTIONS[0] || 'Outsource';
}

/** @deprecated alias — site no longer scopes telco list */
export function defaultTelcoForSite() {
  return defaultTelco();
}

export function normalizeTelco(telco) {
  if (telco && TELCO_OPTIONS.includes(telco)) return telco;
  return defaultTelco();
}

/** @deprecated alias — site no longer scopes telco list */
export function normalizeTelcoForSite(telco) {
  return normalizeTelco(telco);
}

/** SegControl options for SIM ledger telco filter. */
export function telcoFilterOptionsForSite() {
  return [
    { value: 'all', label: 'All Telco' },
    ...TELCO_OPTIONS.map((t) => ({ value: t, label: t })),
  ];
}
