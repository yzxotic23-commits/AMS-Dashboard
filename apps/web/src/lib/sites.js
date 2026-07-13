import { formatRangeCompact } from './governanceDateRange';

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
    all: 'SIM ledger below shows cards across Malaysia and Poipet.',
    my: 'SIM ledger below shows Malaysia cards only.',
    pp: 'SIM ledger below shows Poipet cards only.',
  },
  ips: {
    all: 'IP ledger is shared across sites — proxies are not filtered by Malaysia / Poipet.',
    my: 'IP ledger is shared across sites — proxies stay visible for all sites (not Malaysia-only).',
    pp: 'IP ledger is shared across sites — proxies stay visible for all sites (not Poipet-only).',
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
  '/ips': 'ips',
  '/governance': 'governance',
  '/audit': 'audit',
  '/feedflow': 'feedflow',
};

export function getSiteStripMessage(pathname, site, governanceDate = null) {
  const key = STRIP_PAGE[pathname] || 'operator';
  const siteKey = site === 'all' || site === 'my' || site === 'pp' ? site : 'all';
  let sub = STRIP_SUB[key][siteKey];
  if (key === 'governance' && governanceDate?.from && governanceDate?.to) {
    const range = formatRangeCompact(governanceDate.from, governanceDate.to);
    sub = `Range: ${range} · ${sub}`;
  }
  return {
    label: SITE_BAR[siteKey].label,
    sub,
  };
}

/** Site label bubble — colors aligned with `.site-context-strip--*`. */
export function getSiteChipClass(siteKey) {
  const key = siteKey === 'my' || siteKey === 'pp' || siteKey === 'all' ? siteKey : 'my';
  return `chip-site chip-site-${key}`;
}

export const SITE_STRIP_PATHS = Object.keys(STRIP_PAGE);
