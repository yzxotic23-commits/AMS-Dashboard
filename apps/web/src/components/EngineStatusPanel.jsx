import { Activity, AlertCircle, ExternalLink, MessageSquare, RefreshCw, Wifi, WifiOff, Zap } from 'lucide-react';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { useFeedFlowRefresh } from '../hooks/useFeedFlowRefresh';

const SLOT_STATE_CLASS = {
  online: 'engine-slot-bubble--online',
  linking: 'engine-slot-bubble--linking',
  feeding: 'engine-slot-bubble--feeding',
  offline: 'engine-slot-bubble--offline',
};

function LivePill({ live }) {
  return (
    <span className={`engine-live-pill${live ? ' is-live' : ''}`}>
      {live ? <Wifi size={12} /> : <WifiOff size={12} />}
      {live ? 'Live' : 'Offline'}
    </span>
  );
}

function MetricTile({ label, value, sub, tone = 'default' }) {
  return (
    <div className={`engine-metric engine-metric--${tone}`}>
      <div className="engine-metric-label">{label}</div>
      <div className="engine-metric-value">{value}</div>
      {sub && <div className="engine-metric-sub">{sub}</div>}
    </div>
  );
}

function slotState(slot) {
  if (slot.feedingActive) return 'feeding';
  if (slot.linking) return 'linking';
  if (slot.connected) return 'online';
  return 'offline';
}

function SlotBubble({ slot }) {
  const state = slotState(slot);
  const label = slot.label || `Slot ${slot.slot + 1}`;

  return (
    <span
      className={`engine-slot-bubble ${SLOT_STATE_CLASS[state]}`}
      title={`#${slot.slot + 1} ${label}${slot.phone ? ` · ${slot.phone}` : ''}`}
      aria-label={`Slot ${slot.slot + 1}, ${state}`}
    />
  );
}

/** Read-only engine overview — scan, link, start/stop live in the FeedFlow console. */
export default function EngineStatusPanel() {
  const { data, isLoading, isError, isFetching } = useEngineStatus();
  const { refresh, refreshing } = useFeedFlowRefresh();

  const reachable = data?.reachable === true;
  const boot = data?.boot;
  const isBooting = boot?.state === 'starting' || (isFetching && boot?.autoStart && !reachable);
  const bootFailed = boot?.state === 'failed';
  const engine = data?.engine;
  const feeding = data?.feeding?.summary;
  const slots = data?.slots || [];

  const online = engine?.slotsOnline ?? 0;
  const total = engine?.accountCount ?? slots.length;
  const feedingActive = engine?.slotsFeeding ?? 0;
  const successRate = feeding?.successRate ?? 0;
  const volume = feeding?.totalFeedingVolume ?? 0;

  const isRunning = Boolean(engine?.feedingRunning);
  const isStartingEngine = Boolean(engine?.feedingStarting);

  return (
    <section className="engine-panel card mb-6">
      <div className="engine-panel-head">
        <div className="flex items-center gap-2.5">
          <div className="engine-panel-icon">
            <MessageSquare size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-ams-ink">FeedFlow Engine</h2>
            <p className="text-[11px] text-ams-faint">
              Monitor only — scan QR, link slots, and start/stop feeding in the console.
              {data?.version ? ` · v${data.version}` : ''}
            </p>
          </div>
        </div>
        <div className="engine-panel-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm engine-refresh-btn"
            onClick={() => refresh()}
            disabled={refreshing || isFetching}
            title="Sync engine status, slots, and audit log"
            aria-label="Refresh FeedFlow sync"
          >
            <RefreshCw size={14} className={refreshing || isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
          <LivePill live={reachable && !isError} />
        </div>
      </div>

      {isLoading && !data ? (
        <p className="engine-panel-empty">Loading engine status…</p>
      ) : isBooting ? (
        <div className="engine-boot-banner">
          <div className="engine-boot-spinner" aria-hidden />
          <div>
            <div className="text-sm font-medium text-ams-ink">Starting FeedFlow engine…</div>
            <div className="text-xs text-ams-muted">
              AMS launches the engine automatically — open the console to link accounts.
            </div>
          </div>
        </div>
      ) : !reachable ? (
        <div className="engine-offline-banner">
          <AlertCircle size={16} />
          <div>
            <div className="text-sm font-medium text-ams-ink">
              {bootFailed ? 'FeedFlow engine failed to start' : 'Engine not connected'}
            </div>
            <div className="text-xs text-ams-muted">
              {bootFailed
                ? 'Check that WSAF is installed next to AMS Project and run npm install inside WSAF/.'
                : (data?.error || 'Restart AMS — FeedFlow should start with the API automatically.')}
            </div>
          </div>
        </div>
      ) : (
        <>
          {online < 2 && !isRunning && (
            <div className="engine-feeding-banner engine-feeding-banner--hint">
              <ExternalLink size={14} />
              Link at least 2 slots via QR scan in the console before you can start feeding.
            </div>
          )}

          <div className="engine-metrics">
            <MetricTile
              label="Slots online"
              value={`${online}/${total}`}
              sub={engine?.slotsLinking ? `${engine.slotsLinking} linking` : null}
              tone={online === total && total > 0 ? 'ok' : online > 0 ? 'warn' : 'bad'}
            />
            <MetricTile
              label="Active feeding"
              value={feedingActive}
              sub={isRunning ? 'Run in progress' : isStartingEngine ? 'Starting…' : 'Idle'}
              tone={feedingActive > 0 ? 'accent' : 'default'}
            />
            <MetricTile
              label="Success rate"
              value={`${successRate}%`}
              sub={`${feeding?.successVolume ?? 0} successful`}
              tone={successRate >= 80 ? 'ok' : successRate >= 60 ? 'warn' : 'bad'}
            />
            <MetricTile
              label="Today's volume"
              value={volume}
              sub={`${feeding?.restrictVolume ?? 0} restrict · ${feeding?.bannedVolume ?? 0} banned`}
              tone="default"
            />
          </div>

          {isRunning && (
            <div className="engine-feeding-banner">
              <Zap size={14} />
              Feeding run active
              {engine.feedingLaunchPhase ? ` — ${engine.feedingLaunchPhase}` : ''}
              <span className="text-ams-muted"> · stop from console</span>
            </div>
          )}

          {slots.length > 0 && (
            <div className="engine-slots">
              <div className="engine-slots-row">
                <div className="engine-slots-label">
                  <Activity size={13} />
                  Slots
                  <span className="engine-slots-count">{slots.length}</span>
                </div>
                <div className="engine-slots-bubbles" role="list" aria-label="Engine slot status">
                  {slots.map((s) => (
                    <SlotBubble key={s.slot} slot={s} />
                  ))}
                </div>
                <div className="engine-slots-legend">
                  <span><i className="engine-legend-dot engine-legend-dot--online" /> Online</span>
                  <span><i className="engine-legend-dot engine-legend-dot--linking" /> Linking</span>
                  <span><i className="engine-legend-dot engine-legend-dot--feeding" /> Feeding</span>
                  <span><i className="engine-legend-dot engine-legend-dot--offline" /> Offline</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
