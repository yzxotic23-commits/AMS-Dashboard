import { ExternalLink } from 'lucide-react';
import { useEffect, useRef } from 'react';
import PageHead from '../components/PageHead';
import EngineStatusPanel from '../components/EngineStatusPanel';
import FeedingAuditPanel from '../components/FeedingAuditPanel';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { useAllAccounts } from '../hooks/useOperatorAccounts';
import api from '../lib/api';
import { feedflowSlotLabelBody } from '../lib/feeding-audit';
import { wsafConsoleUrl } from '../lib/wsafEmbed';

export default function FeedFlowPage() {
  const { data } = useEngineStatus();
  const { data: accounts = [] } = useAllAccounts();
  const live = data?.reachable === true;
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!live || syncedRef.current) return;
    const rows = accounts.filter((a) => a.wsaf_slot != null && a.account_name);
    if (!rows.length) return;
    syncedRef.current = true;
    void Promise.all([
      ...rows.map((a) => api.post(
        `/bridge/slots/${a.wsaf_slot}/display-label`,
        feedflowSlotLabelBody(a),
      ).catch(() => {})),
      api.post('/bridge/audit/sync').catch(() => {}),
    ]);
  }, [live, accounts]);

  return (
    <div>
      <PageHead
        title="FeedFlow"
        description="Dashboard monitoring — scan QR, link WhatsApp, and start/stop feeding in the FeedFlow console."
        actions={(
          <a
            href={wsafConsoleUrl()}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary btn-sm"
          >
            <ExternalLink size={14} />
            Open feeding console
          </a>
        )}
      />

      <EngineStatusPanel />

      <FeedingAuditPanel />

      {!live && (
        <p className="mt-4 text-center text-xs text-ams-faint">
          FeedFlow runs on <strong>this computer</strong>. Start{' '}
          <code className="font-mono">npm run dev</code> in AMS Project, then refresh.
          {' '}Works from Vercel URL too if the engine is on the same PC.
        </p>
      )}
    </div>
  );
}
