import { useEffect, useRef, useState, useCallback } from 'react';
import { Copy, Loader2, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import Drawer from './Drawer';
import EngineSlotSelect from './EngineSlotSelect';
import { useWsafSocket } from '../lib/wsafSocket';
import { useBridgeConnect, startBridgeEngine } from '../hooks/useBridgeConnect';
import { normalizePairingPhone } from '../lib/pairing-phone';
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

function formatPairingCodeDisplay(code) {
  const raw = String(code || '').replace(/\D/g, '').toUpperCase();
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return String(code || '').toUpperCase();
}

function slotMatches(dataSlot, slot) {
  return Number(dataSlot) === Number(slot);
}

function slotsFromPayload(payload) {
  return payload?.accounts || payload?.slots || [];
}

/**
 * Prefer QR when a sticky proxy is set — pairing-code flow often triggers
 * WhatsApp's "This might be a scam" interstitial even on a good residential IP.
 * Pairing remains available as fallback.
 */
function defaultLinkMethod(hasProxy = false) {
  if (hasProxy || isLocalBridge()) return 'qr';
  return 'pairing';
}

function linkMethodOptions(hasProxy = false) {
  if (hasProxy || isLocalBridge()) {
    return [
      { key: 'qr', label: 'QR Scan' },
      { key: 'pairing', label: 'Pairing Code' },
    ];
  }
  return [{ key: 'pairing', label: 'Pairing Code' }];
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
  /** socks5://… from AMS Engine proxy — must be set before link on Railway */
  proxyUrl = null,
  requireProxy = false,
}) {
  const canvasRef = useRef(null);
  const [method, setMethod] = useState(() => defaultLinkMethod(Boolean(proxyUrl)));
  const [phone, setPhone] = useState('');
  const [pairingCode, setPairingCode] = useState(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);
  const [message, setMessage] = useState('');
  const [engineBooting, setEngineBooting] = useState(false);
  const linkedRef = useRef(false);
  const linkInflightRef = useRef(false);
  const pairingCodeRef = useRef(null);
  const { connect, disconnect, loading: connectLoading, error: connectError } = useBridgeConnect();
  const methodOptions = linkMethodOptions(Boolean(proxyUrl));

  useEffect(() => {
    pairingCodeRef.current = pairingCode;
  }, [pairingCode]);

  // When Engine proxy becomes available, switch default to QR (avoids scam pairing interstitial).
  useEffect(() => {
    if (!proxyUrl || linking || linked) return;
    setMethod((prev) => (prev === 'pairing' ? 'qr' : prev));
  }, [proxyUrl, linking, linked]);

  const markLinked = useCallback(() => {
    if (linkedRef.current) return;
    linkedRef.current = true;
    setLinked(true);
    setLinking(false);
    setQrVisible(false);
    setPairingCode(null);
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

  useEffect(() => {
    linkedRef.current = false;
    linkInflightRef.current = false;
  }, [open, account?.id]);

  const blockingSlot = (() => {
    if (engineStatus?.linkingSlot != null && engineStatus.linkingSlot !== slot) {
      return engineStatus.linkingSlot;
    }
    const linking = (engineSlots || []).find((s) => s.linking && s.slot !== slot);
    return linking?.slot ?? null;
  })();

  const blockingLabel = blockingSlot != null
    ? (engineSlots.find((s) => s.slot === blockingSlot)?.label || `Account${blockingSlot + 1}`)
    : null;

  useEffect(() => {
    if (!open || !account || engineReachable) return undefined;
    if (!isLocalBridge()) {
      setMessage(`Waiting for ${bridgeEngineLabel()} — confirm Live on the FeedFlow page, then request a code.`);
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

  const accountId = account?.id ?? null;

  useEffect(() => {
    if (!open || accountId == null) return;
    setMethod(defaultLinkMethod());
    setPhone(account?.phone_number || '');
    setPairingCode(null);
    setQrVisible(false);
    setLinking(false);
    setLinked(false);
    setMessage('');
  }, [open, accountId, account?.phone_number]);

  function selectMethod(next) {
    setMethod(next);
    if (next === 'pairing') setQrVisible(false);
    if (next === 'qr') setPairingCode(null);
  }

  useWsafSocket('qr', (data) => {
    if (!open || !slotMatches(data.slot, slot)) return;
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

  useWsafSocket('pairingCode', (data) => {
    if (!open || !slotMatches(data.slot, slot)) return;
    const code = formatPairingCodeDisplay(data.code || data.pairingCode || data.pairingCodeDisplay);
    setPairingCode(code);
    setLinking(true);
    setMessage('Enter this code on your phone: WhatsApp → Linked devices → Link with phone number');
  }, open && slot != null);

  useWsafSocket('pairingCodeFailed', (data) => {
    if (!open || (data?.slot != null && !slotMatches(data.slot, slot))) return;
    setLinking(false);
    setPairingCode(null);
    setMessage(data?.message || 'Could not get pairing code. Check the phone number and try again.');
  }, open && slot != null);

  useWsafSocket('connected', (data) => {
    if (!open || slot == null) return;
    if (data?.slot != null && !slotMatches(data.slot, slot)) return;
    markLinked();
  }, open && slot != null);

  useWsafSocket('status', (status) => {
    if (!open || slot == null) return;
    const acc = slotsFromPayload(status).find((a) => slotMatches(a.slot, slot));
    if (isEngineSlotLinked(acc)) {
      markLinked();
    } else if (acc?.pairingCode && (method === 'pairing' || acc?.loginMethod === 'pairing')) {
      setPairingCode(formatPairingCodeDisplay(acc.pairingCode));
      setLinking(true);
    }
  }, open && slot != null);

  useEffect(() => {
    if (!open || slot == null || linked) return;
    const acc = (engineSlots || []).find((s) => slotMatches(s.slot, slot));
    if (isEngineSlotLinked(acc)) markLinked();
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
        if (!isEngineSlotLinked(acc)) {
          const status = await getBridgeStatus();
          acc = findEngineSlot(status, slot);
        }
        if (cancelled) return;
        if (isEngineSlotLinked(acc)) {
          markLinked();
        } else if (acc?.pairingCode && (method === 'pairing' || acc?.loginMethod === 'pairing')) {
          setPairingCode(formatPairingCodeDisplay(acc.pairingCode));
          setLinking(true);
        }
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
  }, [open, slot, linked, method, markLinked]);

  async function checkConnection() {
    if (slot == null || linked) return;
    setMessage('Checking link status…');
    try {
      const summary = await getBridgeSummary();
      let acc = findEngineSlot(summary, slot);
      if (!isEngineSlotLinked(acc)) {
        const status = await getBridgeStatus();
        acc = findEngineSlot(status, slot);
      }
      if (isEngineSlotLinked(acc)) {
        markLinked();
      } else {
        setMessage('Not linked yet — enter the code on your phone, wait a few seconds, then tap Check again.');
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
    if (slot == null || linkInflightRef.current) return;

    const refreshingCode = method === 'pairing' && Boolean(pairingCode);
    if (refreshingCode) {
      const ok = window.confirm(
        'Request a new pairing code? The current code will stop working immediately.',
      );
      if (!ok) return;
    }

    linkInflightRef.current = true;
    if (!refreshingCode) {
      setPairingCode(null);
      setQrVisible(false);
    }
    setLinking(true);

    const failLink = (msg) => {
      if (!pairingCodeRef.current) {
        setLinking(false);
        setMessage(msg);
      }
    };

    try {
      const body = { method };
      if ((requireProxy || !isLocalBridge()) && !proxyUrl) {
        failLink('Select an Engine proxy first — link must use your IP (avoids Railway scam popup).');
        return;
      }
      if (proxyUrl) {
        setMessage('Binding proxy to FeedFlow…');
        try {
          await syncSlotProxyToEngine(slot, proxyUrl);
        } catch (e) {
          failLink(e.message || 'Could not push proxy to FeedFlow. Check engine connection.');
          return;
        }
        body.proxyUrl = proxyUrl;
      }
      if (method === 'pairing') {
        const pairingPhone = (account.phone_number || phone).trim();
        if (!pairingPhone) {
          failLink('Enter a phone number for pairing code.');
          return;
        }
        body.phoneNumber = normalizePairingPhone(pairingPhone);
        if (!body.phoneNumber) {
          failLink('Invalid phone number format.');
          return;
        }
        if (refreshingCode) {
          body.refreshPairing = true;
          body.clearIncomplete = true;
        }
        // Do not clearIncomplete on first request — wiping a live pairing kills the code
        // and WhatsApp shows "Couldn't link device" even when the digits match.
        setMessage('Requesting pairing code…');
      } else {
        setMessage(proxyUrl ? 'QR via your proxy…' : '');
      }
      const result = await connect(slot, body);
      const codeFromResult = result?.pairingCode || result?.code || result?.pairingCodeDisplay;
      if (method === 'pairing' && codeFromResult) {
        setPairingCode(formatPairingCodeDisplay(codeFromResult));
        setLinking(true);
        setMessage('Enter this code on your phone: WhatsApp → Linked devices → Link with phone number');
      } else if (method === 'qr') {
        setMessage('Waiting for QR from engine…');
      } else if (!pairingCodeRef.current) {
        setMessage('Requesting pairing code… Keep this drawer open and do not click again.');
      }
      onEngineRefresh?.();
    } catch (e) {
      failLink(e.message || connectError || 'Could not start link. Is the engine running?');
    } finally {
      linkInflightRef.current = false;
    }
  }

  const linkStartDisabled = slot == null
    || connectLoading
    || engineBooting
    || ((requireProxy || !isLocalBridge()) && !proxyUrl)
    || (linking && method === 'qr' && !qrVisible)
    || (linking && method === 'pairing' && !pairingCode);

  const linkStartLabel = engineBooting
    ? 'Starting engine…'
    : connectLoading
      ? 'Starting…'
      : pairingCode && method === 'pairing'
        ? 'New pairing code'
        : method === 'qr'
          ? 'Show QR Code'
          : 'Get Pairing Code';

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
          Link runs on the <strong className="text-ams-ink">local FeedFlow engine</strong> (port 47821).
          QR and pairing codes appear here — no separate FeedFlow window needed.
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

      <div className={methodOptions.length > 1 ? 'grid grid-cols-2 gap-2' : ''}>
        {methodOptions.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            disabled={linked}
            className={`drawer-radio ${method === key ? 'drawer-radio-on' : ''}`}
            onClick={() => selectMethod(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {method === 'pairing' && (
        <div className="drawer-field">
          {account.phone_number ? (
            <div className="drawer-locked">
              <div className="drawer-locked-label">Phone number</div>
              <div className="drawer-locked-value drawer-locked-value--mono">{account.phone_number}</div>
            </div>
          ) : (
            <label className="block">
              <span className="drawer-label">Phone number</span>
              <input
                className="input font-mono"
                placeholder="+62…"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={linked}
              />
            </label>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-ams-muted">
            Must match the WhatsApp on this phone. Enter the code within 2 minutes and keep this panel open.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ams-warn">
            Pairing codes often trigger WhatsApp’s “This might be a scam” warning. Prefer <strong>QR Scan</strong> via Engine proxy.
          </p>
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
            {!qrVisible && !pairingCode && (
              <div className="link-wa-placeholder">
                {linking ? (
                  <Loader2 size={24} className="animate-spin text-ams-faint" />
                ) : (
                  <Smartphone size={28} className="text-ams-faint" />
                )}
                <span className="text-xs text-ams-faint">
                  {linking
                    ? (method === 'qr' ? 'Waiting for QR…' : 'Requesting pairing code…')
                    : (method === 'qr'
                      ? 'Scan with WhatsApp → Linked Devices'
                      : 'Get a code to enter on your phone')}
                </span>
                {!linking && linkStartButton}
              </div>
            )}
            {pairingCode && !qrVisible && (() => {
              const parts = pairingCode.includes('-')
                ? pairingCode.split('-')
                : [pairingCode.slice(0, 4), pairingCode.slice(4)];
              return (
              <div className="link-wa-pairing">
                <div className="link-wa-pairing-code" aria-label={`Pairing code ${pairingCode}`}>
                  <span className="link-wa-pairing-half">{parts[0]}</span>
                  <span className="link-wa-pairing-dash" aria-hidden="true">-</span>
                  <span className="link-wa-pairing-half">{parts[1]}</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm link-wa-pairing-copy gap-1.5"
                    onClick={() => {
                      navigator.clipboard?.writeText(pairingCode.replace(/-/g, ''));
                      setMessage('Code copied — enter without spaces or dashes.');
                    }}
                  >
                    <Copy size={14} />
                    Copy code
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={checkConnection}
                  >
                    Check connection
                  </button>
                  {linkStartButton}
                </div>
              </div>
              );
            })()}
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
