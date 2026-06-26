import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { accountToOperatorRow } from '../lib/account-operator-meta';
import { filterRosterForProfile } from '../lib/operator-scope';
import { countRegNeededFromQueue } from '../lib/register-queue';
import { usePreparedQueue } from './usePreparedQueue';
import { useOperatorRoster, operatorDisplayName } from './useOperatorRoster';
import { isManualScanDue } from '../lib/nurturing-day';
import { SITES } from '../lib/sites';

function filterSite(rows, site) {
  if (site === 'all') return rows;
  return rows.filter((r) => r.siteKey === site);
}

function hubCountsFromAccounts(owned, tickets, site) {
  const registering = owned.filter((a) => a.status === 'REGISTERING');
  const nurturing = owned.filter((a) => a.status === 'NURTURING');
  const manual = nurturing.filter((a) => a.nurturing_phase === 'manual');
  const scan = manual.filter((a) => isManualScanDue(a));
  const recovering = owned.filter((a) => a.status === 'RECOVERING' || a.status === 'BANNED');

  const ownedIds = new Set(owned.map((a) => a.id));
  const tkScoped = site === 'all' ? tickets : tickets.filter((t) => t.site_key === site);
  const tk = tkScoped.filter((t) => {
    if (t.delivery_stage !== 'submitted') return false;
    if (!t.account_id) return false;
    return ownedIds.has(t.account_id);
  }).length;

  const counts = {
    reg: 0,
    link: registering.length,
    man: manual.filter((a) => !isManualScanDue(a)).length,
    scan: scan.length,
    rec: recovering.length,
    tk,
  };

  counts.total = counts.reg + counts.link + counts.man + counts.scan + counts.rec + counts.tk;
  return counts;
}

export function resolveAccountOwner(account, regOwnerByAccountId = {}) {
  const fromMeta = String(account.owner || '').trim();
  if (fromMeta) return fromMeta;
  const fromLog = String(regOwnerByAccountId[account.id] || '').trim();
  return fromLog;
}

export function computeHubCounts(accounts, tickets, preparedQueue, site) {
  const scoped = filterSite(accounts, site);
  const counts = hubCountsFromAccounts(scoped, tickets, site);
  counts.reg = countRegNeededFromQueue(preparedQueue, site);
  counts.total = counts.link + counts.man + counts.scan + counts.rec + counts.tk;
  return counts;
}

export function computeHubCountsByOperator(
  accounts,
  tickets,
  preparedQueue,
  site,
  owner,
  regOwnerByAccountId = {},
  ownerSiteKey = null,
) {
  const scoped = filterSite(accounts, site);
  const owned = scoped.filter((a) => {
    if (resolveAccountOwner(a, regOwnerByAccountId) !== owner) return false;
    if (ownerSiteKey && ownerSiteKey !== 'all') {
      return (a.siteKey || 'my') === ownerSiteKey;
    }
    return true;
  });
  return hubCountsFromAccounts(owned, tickets, site);
}

function rosterSiteLabel(op, siteFilter) {
  const sk = op.site_key === 'pp' ? 'pp' : op.site_key === 'all' ? 'all' : 'my';
  if (siteFilter !== 'all') return SITES[siteFilter].name;
  return SITES[sk]?.name || sk;
}

function rosterMatchesSiteFilter(op, siteFilter) {
  if (siteFilter === 'all') return true;
  const sk = op.site_key;
  return sk === siteFilter || sk === 'all';
}

export function buildOperatorHubRows(
  accounts,
  tickets,
  preparedQueue,
  site,
  regOwnerByAccountId = {},
  roster = [],
) {
  const rows = roster
    .filter((op) => rosterMatchesSiteFilter(op, site))
    .map((op) => {
      const name = operatorDisplayName(op);
      const ownerSiteKey = op.site_key === 'pp' ? 'pp' : 'my';
      return {
        code: op.username || op.id,
        name,
        site: ownerSiteKey,
        siteLabel: rosterSiteLabel(op, site),
        ...computeHubCountsByOperator(
          accounts,
          tickets,
          preparedQueue,
          site,
          name,
          regOwnerByAccountId,
          ownerSiteKey,
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.siteLabel.localeCompare(b.siteLabel));

  return rows;
}

export function useHubCountsBySite() {
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'hub'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 300 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    refetchInterval: 30_000,
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', 'hub', 'all'],
    queryFn: async () => {
      const res = await api.get('/tickets');
      return res.data?.data || [];
    },
    refetchInterval: 30_000,
  });

  const { data: preparedQueue = { my: [], pp: [] } } = usePreparedQueue('all');

  return useMemo(() => ({
    all: computeHubCounts(accounts, tickets, preparedQueue, 'all'),
    my: computeHubCounts(accounts, tickets, preparedQueue, 'my'),
    pp: computeHubCounts(accounts, tickets, preparedQueue, 'pp'),
  }), [accounts, tickets, preparedQueue]);
}

export function useHubCounts(site = 'all') {
  const bySite = useHubCountsBySite();
  return bySite[site] || bySite.all;
}

export function useHubOperators(site = 'all') {
  const { profile } = useAuth();
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'hub'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 300 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    refetchInterval: 30_000,
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', 'hub', 'all'],
    queryFn: async () => {
      const res = await api.get('/tickets');
      return res.data?.data || [];
    },
    refetchInterval: 30_000,
  });

  const { data: preparedQueue = { my: [], pp: [] } } = usePreparedQueue('all');
  const {
    data: roster = [],
    isLoading: rosterLoading,
    isError: rosterError,
  } = useOperatorRoster();

  const { data: regLog = [] } = useQuery({
    queryKey: ['registrations', 'log', 'hub-owners'],
    queryFn: async () => {
      const res = await api.get('/registrations', { params: { limit: 200 } });
      return res.data?.data || [];
    },
    staleTime: 30_000,
  });

  const regOwnerByAccountId = useMemo(() => {
    const map = {};
    regLog.forEach((row) => {
      if (row.result !== 'ok' || !row.account_id) return;
      const op = String(row.operator || '').trim();
      if (op && op !== '—') map[row.account_id] = op;
    });
    return map;
  }, [regLog]);

  const scopedRoster = useMemo(
    () => filterRosterForProfile(roster, profile),
    [roster, profile],
  );

  const rows = useMemo(
    () => buildOperatorHubRows(accounts, tickets, preparedQueue, site, regOwnerByAccountId, scopedRoster),
    [accounts, tickets, preparedQueue, site, regOwnerByAccountId, scopedRoster],
  );

  return { rows, rosterLoading, rosterError };
}
