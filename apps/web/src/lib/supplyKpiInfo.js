export const SUPPLY_KPI_INFO = {
  REGISTERING: {
    title: 'Registering target',
    body: 'Raw accounts to register today so enough survive the full chain.',
    formula: 'need ÷ ((1−Fr)×(1−Wf))',
    align: 'center',
  },
  NURTURING: {
    title: 'Nurturing target',
    body: 'Accounts warming to cover front-line loss over 7 days. Gap drives Registering.',
    formula: '(need ÷ (1−Wf)) × W',
    align: 'center',
  },
  AVAILABLE: {
    title: 'Warmed Accounts',
    body: 'Live hand-off count only — no target, no alert.',
    formula: null,
    align: 'center',
  },
  IN_USE: {
    title: 'In Business Use target',
    body: 'Active accounts serving business (headcount × concurrent cap).',
    formula: 'B × C',
    align: 'center',
  },
};

export function kpiInfoForSupply(status) {
  return SUPPLY_KPI_INFO[status] || null;
}
