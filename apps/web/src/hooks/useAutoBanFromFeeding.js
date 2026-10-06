import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { AUTOMATION_HEADERS } from '../lib/api';
import { useFeedingAudit } from './useFeedingAudit';
import { accountToOperatorRow } from '../lib/account-operator-meta';

function matchAuditToAccount(entry, account) {
  const auditName = String(entry.accountName || '').toLowerCase();
  const name = String(account.account_name || '').toLowerCase();
  if (auditName && name && (name === auditName || name.includes(auditName) || auditName.includes(name))) {
    return true;
  }
  const auditPhone = String(entry.phone || entry.phoneNumber || '').replace(/\D/g, '');
  const phone = String(account.phone_number || '').replace(/\D/g, '');
  if (auditPhone && phone && (phone.endsWith(auditPhone.slice(-9)) || auditPhone.endsWith(phone.slice(-9)))) {
    return true;
  }
  if (entry.ipAddress && account.ip && entry.ipAddress === account.ip) return true;
  return false;
}

/** Auto-ban from FeedFlow audit — day 4+ accounts in engine (Feature 5). */
export function useAutoBanFromFeeding() {
  const qc = useQueryClient();
  const { data: audit } = useFeedingAudit(0);
  const processed = useRef(new Set());

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'engine-sync'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { limit: 400 } });
      return (res.data?.data || []).map(accountToOperatorRow);
    },
    refetchInterval: false,
  });

  useEffect(() => {
    if (!audit?.entries?.length || !accounts.length) return;

    const candidates = accounts.filter((a) => {
      if (a.status === 'BANNED' || a.status === 'RECYCLED') return false;
      if (a.status === 'NURTURING') return a.nurturing_phase === 'auto';
      return a.status === 'IN_USE';
    });

    const bannedEntries = audit.entries.filter((e) => e.feedingStatus === 'Banned');
    if (!bannedEntries.length || !candidates.length) return;

    bannedEntries.forEach(async (entry) => {
      const key = `${entry.id || entry.accountName}-${entry.ts}`;
      if (processed.current.has(key)) return;

      const match = candidates.find((a) => matchAuditToAccount(entry, a));
      if (!match) return;

      processed.current.add(key);
      try {
        await api.post(`/accounts/${match.id}/ban`, {
          stage: 'auto',
          reason: 'Engine detected ban',
          source: entry.ipAddress ? `IP ${entry.ipAddress}` : 'FeedFlow audit',
        }, { headers: AUTOMATION_HEADERS });
        qc.invalidateQueries({ queryKey: ['accounts'] });
        qc.invalidateQueries({ queryKey: ['ips'] });
        qc.invalidateQueries({ queryKey: ['bans'] });
      } catch {
        processed.current.delete(key);
      }
    });
  }, [audit, accounts, qc]);
}
