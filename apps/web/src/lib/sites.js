export const SITES = {
  all: { id: 'all', name: 'All sites', short: 'All' },
  my: { id: 'my', name: 'Malaysia', short: 'MY' },
  pp: { id: 'pp', name: 'Poipet', short: 'PP' },
};

export const SITE_OPTIONS = ['all', 'my', 'pp'];

export const SITE_BAR = {
  all: { label: 'All sites' },
  my: { label: 'Malaysia' },
  pp: { label: 'Poipet' },
};

const STRIP_SUB = {
  operator: {
    all: 'Register / Activation / Nurturing / Recovery below show devices & accounts across all sites.',
    my: 'Register / Activation / Nurturing / Recovery below show only this site\'s devices & accounts.',
    pp: 'Register / Activation / Nurturing / Recovery below show only this site\'s devices & accounts.',
  },
  governance: {
    all: 'Governance metrics below combine Malaysia and Poipet.',
    my: 'Governance metrics below reflect Malaysia only.',
    pp: 'Governance metrics below reflect Poipet only.',
  },
  audit: {
    all: 'Audit log below shows activity across all sites.',
    my: 'Audit log below is filtered to Malaysia activity.',
    pp: 'Audit log below is filtered to Poipet activity.',
  },
  feedflow: {
    all: 'Feeding audit and metrics below combine Malaysia and Poipet.',
    my: 'Feeding audit below shows Malaysia outcomes only.',
    pp: 'Feeding audit below shows Poipet outcomes only.',
  },
  ledger: {
    all: 'Resource ledger below shows devices & accounts across all sites.',
    my: 'Resource ledger below shows only this site\'s devices & accounts.',
    pp: 'Resource ledger below shows only this site\'s devices & accounts.',
  },
  resources: {
    all: 'IP and SIM ledgers below show resources across Malaysia and Poipet.',
    my: 'IP and SIM ledgers below show Malaysia resources only.',
    pp: 'IP and SIM ledgers below show Poipet resources only.',
  },
};

const STRIP_PAGE = {
  '/': 'operator',
  '/register': 'operator',
  '/activation': 'operator',
  '/link': 'operator',
  '/nurturing': 'operator',
  '/recovery': 'operator',
  '/tickets': 'operator',
  '/accounts': 'ledger',
  '/sims': 'resources',
  '/ips': 'resources',
  '/governance': 'governance',
  '/audit': 'audit',
  '/feedflow': 'feedflow',
};

export function getSiteStripMessage(pathname, site) {
  const key = STRIP_PAGE[pathname] || 'operator';
  const siteKey = site === 'all' || site === 'my' || site === 'pp' ? site : 'all';
  return {
    label: SITE_BAR[siteKey].label,
    sub: STRIP_SUB[key][siteKey],
  };
}

/** Site label bubble — colors aligned with `.site-context-strip--*`. */
export function getSiteChipClass(siteKey) {
  const key = siteKey === 'my' || siteKey === 'pp' || siteKey === 'all' ? siteKey : 'my';
  return `chip-site chip-site-${key}`;
}

export const SITE_STRIP_PATHS = Object.keys(STRIP_PAGE);
