import { useEffect, useRef, useState, useCallback } from 'react';
import { Copy, Loader2, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import Drawer from './Drawer';
import EngineSlotSelect from './EngineSlotSelect';
import { useWsafSocket } from '../lib/wsafSocket';
import { useBridgeConnect, startBridgeEngine } from '../hooks/useBridgeConnect';
import { normalizePairingPhone } from '../lib/pairing-phone';
import { feedflowSlotLabelBody } from '../lib/feeding-audit';
import api from '../lib/api';

function formatPairingCodeDisplay(code) {
  const raw = String(code || '').replace(/\D/g, '').toUpperCase();
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return String(code || '').toUpperCase();
}

function slotMatches(dataSlot, slot) {
  return Number(dataSlot) === Number(slot);
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
}) {
  const canvasRef = useRef(null);
  const [method, setMethod] = useState('qr');
  const [phone, setPhone] = useState('');
  const [pairingCode, setPairingCode] = useState(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);
  const [message, setMessage] = useState('');
  const [engineBooting, setEngineBooting] = useState(false);
  const linkedRef = useRef(false);
  const linkInflightRef = useRef(false);
  const { connect, disconnect, loading: connectLoading, error: connectError } = useBridgeConnect();

  const markLinked = useCallback(() => {
    if (linkedRef.current) return;
    linkedRef.current = true;
    setLinking(false);
    setMessage('WhatsApp linked successfully.');
    void (async () => {
      try {
        if (slot != null && account?.account_name) {
          await api.post(`/bridge/slots/${slot}/display-label`, feedflowSlotLabelBody(account));
          await api.post('/bridge/audit/sync').catch(() => {});
        }
        await onLinked?.();
        onClose?.();
      } catch (e) {
        linkedRef.current = false;
        setLinked(false);
        setMessage(e?.message || 'Could not save link status.');
      }
    })();
  }, [onLinked, onClose, slot, account?.account_name, account?.phone_number]);

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

  useEffect(() => {
    if (!open || !account) return;
    setMethod('qr');
    setPhone(account.phone_number || '');
    setPairingCode(null);
    setQrVisible(false);
    setLinking(false);
    setLinked(false);
    setMessage('');
  }, [open, account]);

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

  useWsafSocket('status', (status) => {
    if (!open || slot == null) return;
    const acc = (status.accounts || []).find((a) => slotMatches(a.slot, slot));
    if (acc?.connected) {
      markLinked();
    } else if (acc?.pairingCode && method === 'pairing') {
      setPairingCode(formatPairingCodeDisplay(acc.pairingCode));
      setLinking(true);
    }
  }, open && slot != null);

  useEffect(() => {
    if (!open || slot == null || linked) return undefined;
    let cancelled = false;

    async function pollStatus() {
      try {
        const { data } = await api.get('/bridge/status');
        if (cancelled || !data?.reachable) return;
        const acc = (data.accounts || []).find((a) => slotMatches(a.slot, slot));
        if (acc?.connected) {
          markLinked();
        } else if (acc?.pairingCode && method === 'pairing') {
          setPairingCode(formatPairingCodeDisplay(acc.pairingCode));
          setLinking(true);
        }
      } catch {
        /* engine offline — socket may still work */
      }
    }

    if (linking || pairingCode) {
      pollStatus();
      const timer = setInterval(pollStatus, 2500);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }
    return undefined;
  }, [open, slot, linked, linking, pairingCode, method, markLinked]);

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
    setMessage('');
    if (!refreshingCode) {
      setPairingCode(null);
      setQrVisible(false);
    }
    setLinking(true);

    try {
      const body = { method };
      if (method === 'pairing') {
        const pairingPhone = (account.phone_number || phone).trim();
        if (!pairingPhone) {
          setLinking(false);
          setMessage('Enter a phone number for pairing code.');
          return;
        }
        body.phoneNumber = normalizePairingPhone(pairingPhone);
        if (!body.phoneNumber) {
          setLinking(false);
          setMessage('Invalid phone number format.');
          return;
        }
        if (refreshingCode) {
          body.refreshPairing = true;
          body.clearIncomplete = true;
        } else {
          body.clearIncomplete = true;
        }
        setMessage('Requesting pairing code…');
      }
      await connect(slot, body);
      setMessage(method === 'qr'
        ? 'Waiting for QR from engine…'
        : pairingCode
          ? 'New pairing code requested — enter it on your phone within 2 minutes.'
          : 'Requesting pairing code… Keep this drawer open and do not click again.');
    } catch (e) {
      setLinking(false);
      setMessage(e.message || connectError || 'Could not start link. Is the engine running?');
    } finally {
      linkInflightRef.current = false;
    }
  }

  return (
    <Drawer
      open={open}
      title="Link WhatsApp"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {!linked ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                slot == null
                || connectLoading
                || engineBooting
                || (linking && method === 'qr' && !pairingCode)
                || (linking && method === 'pairing' && !pairingCode)
              }
              onClick={startLink}
            >
              {engineBooting
                ? 'Starting engine…'
                : connectLoading
                  ? 'Starting…'
                  : pairingCode && method === 'pairing'
                    ? 'New pairing code'
                    : method === 'qr'
                      ? 'Show QR Code'
                      : 'Get Pairing Code'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          )}
        </>
      )}
    >
      {account && (
        <div className="space-y-4">
          <p className="rounded-lg bg-ams-surface-muted px-3 py-2 text-[12.5px] leading-relaxed text-ams-muted">
            Link runs on the <strong className="text-ams-ink">local FeedFlow engine</strong> (port 47821).
            QR and pairing codes appear here — no separate FeedFlow window needed.
          </p>

          {!engineReachable && !linked && (
            <p className="rounded-lg border border-ams-warn/40 bg-ams-warn/10 px-3 py-2 text-[12px] text-ams-warn">
              FeedFlow engine is offline. AMS will try to start it automatically when this panel opens.
            </p>
          )}

          <div className="drawer-locked">
            <div className="drawer-locked-label">Account</div>
            <div className="text-sm font-semibold">{account.account_name}</div>
          </div>

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
            <p className="text-sm text-ams-danger">Assign an engine slot before linking.</p>
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

          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'qr', label: 'QR Scan' },
              { key: 'pairing', label: 'Pairing Code' },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                disabled={linked}
                className={`drawer-radio ${method === key ? 'drawer-radio-on' : ''}`}
                onClick={() => setMethod(key)}
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
            </div>
          )}

          <div className="link-wa-panel">
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
                {!qrVisible && method === 'qr' && !pairingCode && (
                  <div className="link-wa-placeholder">
                    {linking ? <Loader2 size={24} className="animate-spin text-ams-faint" /> : <Smartphone size={28} className="text-ams-faint" />}
                    <span className="text-xs text-ams-faint">
                      {linking ? 'Waiting for QR…' : 'Click Show QR Code to start'}
                    </span>
                  </div>
                )}
                {pairingCode && (() => {
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
      )}
    </Drawer>
  );
}
