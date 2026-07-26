import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import Drawer from './Drawer';
import EngineSlotSelect from './EngineSlotSelect';
import { useWsafSocket } from '../lib/wsafSocket';
import { useBridgeConnect, startBridgeEngine } from '../hooks/useBridgeConnect';
import { feedflowSlotLabelBody } from '../lib/feeding-audit';
import {
  getBridgeStatus,
  getBridgeSummary,
  findEngineSlot,
  isEngineSlotLinked,
  syncSlotProxyToEngine,
} from '../lib/bridge-client';
import { bridgeEngineLabel, isLocalBridge } from '../lib/wsafEmbed';
import api from '../lib/api';

function slotMatches(dataSlot, slot) {
  return Number(dataSlot) === Number(slot);
}

function slotsFromPayload(payload) {
  return payload?.accounts || payload?.slots || [];
}

/** Only live socket online counts — never auth leftovers / other-slot events. */
function slotIsLiveConnected(acc, expectedSlot) {
  if (expectedSlot == null || !acc) return false;
  if (!slotMatches(acc.slot, expectedSlot)) return false;
  return isEngineSlotLinked(acc);
}

export default function LinkWhatsAppDrawer({
  open,
  account,
  slot,
  engineSlots = [],
  slotTakenBy = {},
  onSlotChange,
  engineReachable = true,
  engineStatus = null,
  onEngineRefresh,
  onClose,
  onLinked,
  embedded = false,
  hideAccountRow = false,
  /** socks5://… from AMS Engine proxy — optional; empty = intentional direct (phone Shadowrocket) */
  proxyUrl = null,
}) {
  const canvasRef = useRef(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);
  const [message, setMessage] = useState('');
  const [engineBooting, setEngineBooting] = useState(false);
  const linkedRef = useRef(false);
  const linkInflightRef = useRef(false);
  const slotRef = useRef(slot);
  const { connect, disconnect, loading: connectLoading, error: connectError } = useBridgeConnect();

  useEffect(() => {
    slotRef.current = slot;
  }, [slot]);

  const resetLinkUi = useCallback(() => {
    linkedRef.current = false;
    linkInflightRef.current = false;
    setLinked(false);
    setLinking(false);
    setQrVisible(false);
    setMessage('');
  }, []);

  const markLinked = useCallback(() => {
    if (linkedRef.current) return;
    linkedRef.current = true;
    setLinked(true);
    setLinking(false);
    setQrVisible(false);
    setMessage('WhatsApp linked successfully.');
    void (async () => {
      try {
        await onLinked?.();
      } catch (e) {
        setMessage(e?.message || 'Linked on engine — could not save to AMS.');
        return;
      }
      if (slot != null && account?.account_name) {
        await api.post(`/bridge/slots/${slot}/display-label`, feedflowSlotLabelBody(account)).catch(() => {});
        await api.post('/bridge/audit/sync').catch(() => {});
      }
      if (!embedded) onClose?.();
      onEngineRefresh?.();
    })();
  }, [onLinked, onClose, slot, account, embedded, onEngineRefresh]);

  // Hard reset whenever drawer opens, account changes, or slot changes.
  useEffect(() => {
    if (!open) {
      resetLinkUi();
      return;
    }
    resetLinkUi();
  }, [open, account?.id, slot, resetLinkUi]);

  const blockingSlot = (() => {
    if (engineStatus?.linkingSlot != null && engineStatus.linkingSlot !== slot) {
      return engineStatus.linkingSlot;
    }
    const linkingAcc = (engineSlots || []).find((s) => s.linking && s.slot !== slot);
    return linkingAcc?.slot ?? null;
  })();

  const blockingLabel = blockingSlot != null
    ? (engineSlots.find((s) => s.slot === blockingSlot)?.label || `Account${blockingSlot + 1}`)
    : null;

  useEffect(() => {
    if (!open || !account || engineReachable) return undefined;
    if (!isLocalBridge()) {
      setMessage(`Waiting for ${bridgeEngineLabel()} — confirm Live on the FeedFlow page, then show QR.`);
      onEngineRefresh?.();
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setEngineBooting(true);
      setMessage('Starting FeedFlow engine…');
      try {
        await startBridgeEngine();
        if (!cancelled) {
          setMessage('Engine ready — click Show QR Code to link.');
          onEngineRefresh?.();
        }
      } catch (e) {
        if (!cancelled) {
          setMessage(e.message || 'Engine offline. Restart npm run dev or run node web.js in the WSAF folder.');
        }
      } finally {
        if (!cancelled) setEngineBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, account, engineReachable, onEngineRefresh]);

  useWsafSocket('qr', (data) => {
    if (!open || slot == null || !slotMatches(data.slot, slot)) return;
    if (linkedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, data.qr, { width: 200, margin: 1 }, (err) => {
      if (!err) {
        setQrVisible(true);
        setLinking(true);
        setMessage('Scan with WhatsApp → Linked Devices');
      }
    });
  }, open && slot != null);

  useWsafSocket('connected', (data) => {
    if (!open || slot == null) return;
    // Require explicit slot — never inherit Connected from another account reconnect.
    if (data?.slot == null || !slotMatches(data.slot, slot)) return;
    markLinked();
  }, open && slot != null);

  useWsafSocket('status', (status) => {
    if (!open || slot == null || linkedRef.current) return;
    const acc = slotsFromPayload(status).find((a) => slotMatches(a.slot, slot));
    if (slotIsLiveConnected(acc, slot)) markLinked();
  }, open && slot != null);

  useEffect(() => {
    if (!open || slot == null || linked) return;
    const acc = (engineSlots || []).find((s) => slotMatches(s.slot, slot));
    if (slotIsLiveConnected(acc, slot)) markLinked();
  }, [open, slot, engineSlots, linked, markLinked]);

  useEffect(() => {
    if (engineReachable && !linked) {
      setMessage((m) => (
        /not running|offline|could not start/i.test(m) ? '' : m
      ));
    }
  }, [engineReachable, linked]);

  useEffect(() => {
    if (!open || slot == null || linked) return undefined;
    let cancelled = false;

    async function pollStatus() {
      try {
        const summary = await getBridgeSummary();
        let acc = findEngineSlot(summary, slot);
        if (!slotIsLiveConnected(acc, slot)) {
          const status = await getBridgeStatus();
          acc = findEngineSlot(status, slot);
        }
        if (cancelled || Number(slotRef.current) !== Number(slot)) return;
        if (slotIsLiveConnected(acc, slot)) markLinked();
      } catch {
        /* engine offline — socket may still work */
      }
    }

    pollStatus();
    const timer = setInterval(pollStatus, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, slot, linked, markLinked]);

  async function checkConnection() {
    if (slot == null || linked) return;
    setMessage('Checking link status…');
    try {
      const summary = await getBridgeSummary();
      let acc = findEngineSlot(summary, slot);
      if (!slotIsLiveConnected(acc, slot)) {
        const status = await getBridgeStatus();
        acc = findEngineSlot(status, slot);
      }
      if (slotIsLiveConnected(acc, slot)) {
        markLinked();
      } else {
        setMessage('Not linked yet — scan the QR, wait a few seconds, then tap Check again.');
      }
    } catch (e) {
      setMessage(e?.message || 'Could not reach FeedFlow engine.');
    }
  }

  async function cancelBlockingLink() {
    if (blockingSlot == null) return;
    setMessage('');
    try {
      await disconnect(blockingSlot);
      onEngineRefresh?.();
      setMessage(`Cancelled linking on ${blockingLabel || `slot ${blockingSlot + 1}`}. Try again.`);
    } catch (e) {
      setMessage(e.message || 'Could not cancel the other link session.');
    }
  }

  async function startLink() {
    if (slot == null || linkInflightRef.current || linkedRef.current) return;

    // Never re-hit connect if this slot is already live — causes 440 conflict loops.
    const live = (engineSlots || []).find((s) => slotMatches(s.slot, slot));
    if (slotIsLiveConnected(live, slot)) {
      markLinked();
      return;
    }

    linkInflightRef.current = true;
    setQrVisible(false);
    setLinking(true);

    const failLink = (msg) => {
      setLinking(false);
      setMessage(msg);
    };

    try {
      const body = { method: 'qr' };
      setMessage(proxyUrl ? 'Binding proxy to FeedFlow…' : 'Setting direct (no AMS proxy)…');
      try {
        await syncSlotProxyToEngine(slot, proxyUrl || 'direct');
      } catch (e) {
        failLink(e.message || 'Could not push proxy route to FeedFlow. Check engine connection.');
        return;
      }
      if (proxyUrl) {
        body.proxyUrl = proxyUrl;
      } else {
        body.direct = true;
        body.proxyUrl = 'direct';
      }
      setMessage(proxyUrl ? 'QR via your proxy…' : 'QR via direct (phone Shadowrocket)…');
      const result = await connect(slot, body);
      if (result?.alreadyConnected || result?.skipped === 'auto-connect-blocked') {
        markLinked();
        return;
      }
      if (result?.linkInProgress || result?.connectInFlight || result?.reclaimInProgress) {
        setMessage('Link already in progress on engine — wait, do not click again.');
        return;
      }
      setMessage('Waiting for QR from engine…');
      onEngineRefresh?.();
    } catch (e) {
      failLink(e.message || connectError || 'Could not start QR link. Is the engine running?');
    } finally {
      linkInflightRef.current = false;
    }
  }

  const linkStartDisabled = slot == null
    || connectLoading
    || engineBooting
    || (linking && !qrVisible);

  const linkStartLabel = engineBooting
    ? 'Starting engine…'
    : connectLoading
      ? 'Starting…'
      : 'Show QR Code';

  const linkStartButton = !linked ? (
    <button
      type="button"
      className={`btn btn-sm ${embedded ? 'btn-secondary' : 'btn-primary'}`}
      disabled={linkStartDisabled}
      onClick={startLink}
    >
      {linkStartLabel}
    </button>
  ) : null;

  const panelBody = account && (
    <div className={embedded ? 'link-wa-flow link-wa-flow--embedded' : 'space-y-4'}>
      {!embedded && (
        <p className="rounded-lg bg-ams-surface-muted px-3 py-2 text-[12.5px] leading-relaxed text-ams-muted">
          Link runs on the <strong className="text-ams-ink">FeedFlow engine</strong>.
          Scan the QR here — pairing code is disabled (unreliable on cloud).
        </p>
      )}

      {!engineReachable && !linked && (
        <p className={embedded
          ? 'text-[11px] leading-relaxed text-ams-warn'
          : 'rounded-lg border border-ams-warn/40 bg-ams-warn/10 px-3 py-2 text-[12px] text-ams-warn'}
        >
          {embedded
            ? (isLocalBridge()
              ? 'FeedFlow engine offline — AMS will try to start it automatically.'
              : 'FeedFlow cloud offline — check Railway is Live on the FeedFlow page, then retry.')
            : (isLocalBridge()
              ? 'FeedFlow engine is offline. AMS will try to start it automatically when this panel opens.'
              : 'FeedFlow cloud engine is offline. Open the FeedFlow page and confirm status is Live (Railway).')}
        </p>
      )}

      {!hideAccountRow && (
        <div className="drawer-locked">
          <div className="drawer-locked-label">Account</div>
          <div className="text-sm font-semibold">{account.account_name}</div>
        </div>
      )}

      <label className="drawer-field">
        <span className="drawer-label">Engine slot</span>
        {onSlotChange ? (
          <EngineSlotSelect
            value={slot}
            engineSlots={engineSlots}
            slotTakenBy={slotTakenBy}
            onChange={onSlotChange}
            className="input"
          />
        ) : (
          <div className="text-sm font-mono text-ams-muted">
            {slot != null ? `Slot ${slot + 1}` : 'No slot assigned'}
          </div>
        )}
      </label>

      {slot == null && (
        <p className={embedded ? 'text-[11px] text-ams-muted' : 'text-sm text-ams-danger'}>
          Assign an engine slot before linking.
        </p>
      )}

      {blockingSlot != null && !linked && (
        <div className="rounded-lg border border-ams-danger/30 bg-ams-danger/5 px-3 py-2.5 text-[12px] text-ams-danger">
          <p>
            <strong>{blockingLabel}</strong> is still linking. FeedFlow allows one link at a time.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2 text-ams-danger"
            disabled={connectLoading}
            onClick={cancelBlockingLink}
          >
            Cancel linking on {blockingLabel}
          </button>
        </div>
      )}

      <div className={`link-wa-panel${embedded ? ' link-wa-panel--embedded' : ''}`}>
        {linked ? (
          <div className="link-wa-success">
            <Smartphone size={28} className="text-ams-success" />
            <span className="text-sm font-semibold text-ams-success">Connected</span>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className={`link-wa-qr${qrVisible ? ' is-visible' : ''}`}
              aria-hidden={!qrVisible}
            />
            {!qrVisible && (
              <div className="link-wa-placeholder">
                {linking ? (
                  <Loader2 size={24} className="animate-spin text-ams-faint" />
                ) : (
                  <Smartphone size={28} className="text-ams-faint" />
                )}
                <span className="text-xs text-ams-faint">
                  {linking
                    ? 'Waiting for QR…'
                    : 'Scan with WhatsApp → Linked Devices'}
                </span>
                {!linking && linkStartButton}
              </div>
            )}
            {qrVisible && (
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={checkConnection}
                >
                  Check connection
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {message && (
        <p className={`text-xs ${
          linked
            ? 'text-ams-success'
            : (message.includes('still linking') || message.includes('engine') || message.includes('FeedFlow') || message.includes('Could not'))
              ? 'text-ams-danger'
              : 'text-ams-muted'
        }`}>
          {message}
        </p>
      )}
    </div>
  );

  if (embedded) {
    if (!open || !account) return null;
    return panelBody;
  }

  return (
    <Drawer
      open={open}
      title="Link WhatsApp"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {linked && (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          )}
        </>
      )}
    >
      {panelBody}
    </Drawer>
  );
}
