import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import {
  fetchWsafBridgeSummary,
  fetchWsafEngineStatus,
  fetchWsafFeedingAudit,
  postWsafConnect,
  postWsafDisconnect,
  postWsafSlotDisplayLabel,
  postWsafSlotProxy,
  postWsafAuditSync,
  postWsafAuditRecord,
  postWsafStartFeeding,
  postWsafStopFeeding,
  refreshWsafBridgeState,
} from '../../lib/wsafBridge.js';
import { ensureWsafEngineReady, getWsafBootStatus } from '../../lib/wsafEngineManager.js';

const router = Router();

router.get('/summary', authenticate, async (_req, res, next) => {
  try {
    const data = await fetchWsafBridgeSummary();
    res.json({ ...data, boot: getWsafBootStatus() });
  } catch (e) {
    next(e);
  }
});

router.get('/status', authenticate, async (_req, res) => {
  try {
    const data = await fetchWsafEngineStatus();
    res.json({ ok: true, reachable: true, ...data });
  } catch (e) {
    res.status(200).json({
      ok: false,
      reachable: false,
      error: e.message || 'Engine offline',
      accounts: [],
      boot: getWsafBootStatus(),
    });
  }
});

router.post('/engine/start', authenticate, async (_req, res) => {
  try {
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({
        ok: false,
        reachable: false,
        error: 'FeedFlow engine could not start. Check the API terminal for [WSAF] errors.',
        boot: getWsafBootStatus(),
      });
    }
    const data = await fetchWsafEngineStatus();
    res.json({ ok: true, reachable: true, boot: getWsafBootStatus(), ...data });
  } catch (e) {
    res.status(503).json({
      ok: false,
      reachable: false,
      error: e.message || 'Engine start failed',
      boot: getWsafBootStatus(),
    });
  }
});

router.post('/connect/:slot', authenticate, async (req, res, next) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    if (Number.isNaN(slot) || slot < 0) {
      return res.status(400).json({ error: 'Invalid slot' });
    }
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({
        error: 'FeedFlow engine is not running. Restart the AMS API (npm run dev) and try again.',
      });
    }
    const data = await postWsafConnect(slot, req.body || {});
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Connect failed' });
  }
});

router.post('/disconnect/:slot', authenticate, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    if (Number.isNaN(slot) || slot < 0) {
      return res.status(400).json({ error: 'Invalid slot' });
    }
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({
        error: 'FeedFlow engine is not running. Restart the AMS API (npm run dev) and try again.',
      });
    }
    const data = await postWsafDisconnect(slot);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Disconnect failed' });
  }
});

router.post('/feeding/start', authenticate, async (_req, res) => {
  try {
    const data = await postWsafStartFeeding();
    res.json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'Start feeding failed' });
  }
});

router.post('/feeding/stop', authenticate, async (_req, res) => {
  try {
    const data = await postWsafStopFeeding();
    res.json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'Stop feeding failed' });
  }
});

router.post('/refresh', authenticate, async (_req, res) => {
  try {
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({
        ok: false,
        reachable: false,
        error: 'FeedFlow engine is not running.',
        boot: getWsafBootStatus(),
      });
    }
    const data = await refreshWsafBridgeState();
    res.json({ ok: true, ...data, boot: getWsafBootStatus() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'Refresh failed', boot: getWsafBootStatus() });
  }
});

router.post('/slots/:slot/display-label', authenticate, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    if (Number.isNaN(slot) || slot < 0) {
      return res.status(400).json({ error: 'Invalid slot' });
    }
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({ error: 'FeedFlow engine is not running.' });
    }
    const data = await postWsafSlotDisplayLabel(slot, {
      accountName: req.body?.accountName || req.body?.account_name,
      phone: req.body?.phone || req.body?.phone_number,
      siteKey: req.body?.siteKey || req.body?.site_key,
      location: req.body?.location,
      ipAddress: req.body?.ipAddress || req.body?.ip_address,
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not sync slot label' });
  }
});

router.post('/slots/:slot/proxy', authenticate, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    if (Number.isNaN(slot) || slot < 0) {
      return res.status(400).json({ error: 'Invalid slot' });
    }
    const proxyUrl = req.body?.proxyUrl || req.body?.proxy_url;
    if (!proxyUrl) {
      return res.status(400).json({ error: 'proxyUrl required' });
    }
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({ error: 'FeedFlow engine is not running.' });
    }
    const data = await postWsafSlotProxy(slot, proxyUrl);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not sync slot proxy' });
  }
});

router.post('/audit/sync', authenticate, async (_req, res) => {
  try {
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({ ok: false, error: 'FeedFlow engine is not running.' });
    }
    const data = await postWsafAuditSync();
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'Audit sync failed' });
  }
});

router.post('/audit/record', authenticate, async (req, res) => {
  try {
    const ready = await ensureWsafEngineReady();
    if (!ready) {
      return res.status(503).json({ ok: false, error: 'FeedFlow engine is not running.' });
    }
    const data = await postWsafAuditRecord(req.body || {});
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'Could not record feeding audit' });
  }
});

router.get('/audit', authenticate, async (req, res) => {
  try {
    const rawLimit = req.query.limit;
    // Omit/0/invalid → fetch full log via large positive limit (never send 0 to engine).
    const parsed = rawLimit == null || rawLimit === '' ? 0 : parseInt(rawLimit, 10);
    const limit = Number.isFinite(parsed) ? parsed : 0;
    const offset = parseInt(req.query.offset || '0', 10);
    const opts = { limit, offset };
    let data = await fetchWsafFeedingAudit(opts);
    if (offset === 0 && !(data?.entries?.length)) {
      try {
        await postWsafAuditSync();
        data = await fetchWsafFeedingAudit(opts);
      } catch {
        /* keep empty */
      }
    }
    res.json({ ok: true, reachable: true, entries: data?.entries || [], ...data });
  } catch (e) {
    res.status(200).json({
      ok: false,
      reachable: false,
      entries: [],
      error: e.message || 'Feeding audit unavailable',
    });
  }
});

export default router;
