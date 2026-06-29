import { ExternalLink } from 'lucide-react';
import PageHead from '../components/PageHead';
import EngineStatusPanel from '../components/EngineStatusPanel';
import FeedingAuditPanel from '../components/FeedingAuditPanel';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { wsafConsoleUrl } from '../lib/wsafEmbed';

export default function FeedFlowPage() {
  const { data } = useEngineStatus();
  const live = data?.reachable === true;

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
