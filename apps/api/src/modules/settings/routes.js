import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { writeAudit } from '../../lib/audit.js';
import {
  defaultRmSupplySettings,
  loadRmSupplySettings,
  normalizeRmSupplySettings,
  saveRmSupplySettings,
} from '../../lib/rmSupplySettings.js';
import { loadRmSupplyModel } from '../../lib/rmSupplyData.js';
import { clientIp } from '../../lib/clientIp.js';
import {
  ipMatchesAllowlist,
  loadIpAllowlist,
  parseAllowlistValue,
  saveIpAllowlist,
} from '../../lib/ipAllowlist.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin'));

const siteConfigSchema = z.object({
  sources: z.record(z.enum(['live', 'manual'])).optional(),
  manual: z.record(z.coerce.number()).optional(),
});

const patchSchema = z.object({
  my: siteConfigSchema.optional(),
  pp: siteConfigSchema.optional(),
});

router.get('/rm-supply', async (_req, res, next) => {
  try {
    const [config, model] = await Promise.all([
      loadRmSupplySettings(),
      loadRmSupplyModel('all'),
    ]);
    res.json({ config, model });
  } catch (e) {
    next(e);
  }
});

router.patch('/rm-supply', async (req, res, next) => {
  try {
    const body = patchSchema.parse(req.body);
    const prev = await loadRmSupplySettings();
    const merged = normalizeRmSupplySettings({
      my: { ...prev.my, ...body.my, sources: { ...prev.my?.sources, ...body.my?.sources }, manual: { ...prev.my?.manual, ...body.my?.manual } },
      pp: { ...prev.pp, ...body.pp, sources: { ...prev.pp?.sources, ...body.pp?.sources }, manual: { ...prev.pp?.manual, ...body.pp?.manual } },
    });
    const config = await saveRmSupplySettings(merged, req.user.id);
    const model = await loadRmSupplyModel('all');

    await writeAudit({
      entityType: 'app_settings',
      entityId: null,
      action: 'RM_SUPPLY_UPDATE',
      previousValue: prev,
      newValue: config,
      userId: req.user.id,
      req,
    });

    res.json({ config, model });
  } catch (e) {
    next(e);
  }
});

router.post('/rm-supply/reset', async (req, res, next) => {
  try {
    const prev = await loadRmSupplySettings();
    const config = await saveRmSupplySettings(defaultRmSupplySettings(), req.user.id);
    const model = await loadRmSupplyModel('all');

    await writeAudit({
      entityType: 'app_settings',
      entityId: null,
      action: 'RM_SUPPLY_RESET',
      previousValue: prev,
      newValue: config,
      userId: req.user.id,
      req,
    });

    res.json({ config, model });
  } catch (e) {
    next(e);
  }
});

const allowlistSchema = z.object({
  enabled: z.boolean(),
  entries: z.array(z.object({
    value: z.string().trim().min(1).max(64),
    label: z.string().trim().max(80).optional().default(''),
    department: z.string().trim().max(40).optional().default(''),
    user: z.string().trim().max(60).optional().default(''),
    remark: z.string().trim().max(200).optional().default(''),
    active: z.boolean().optional().default(true),
  })).max(200),
});

router.get('/ip-allowlist', async (req, res, next) => {
  try {
    const config = await loadIpAllowlist({ fresh: true });
    res.json({
      config,
      your_ip: clientIp(req),
      bypass_active: process.env.IP_ALLOWLIST_BYPASS === '1',
    });
  } catch (e) {
    next(e);
  }
});

router.put('/ip-allowlist', async (req, res, next) => {
  try {
    const body = allowlistSchema.parse(req.body);
    const invalid = body.entries.filter((e) => !parseAllowlistValue(e.value)).map((e) => e.value);
    if (invalid.length) {
      return res.status(400).json({ error: `Not a valid IP or CIDR range: ${invalid.join(', ')}` });
    }
    const yourIp = clientIp(req);
    if (body.enabled && !body.entries.some((e) => e.active)) {
      return res.status(400).json({ error: 'Add at least one active IP before turning the allowlist on' });
    }
    if (body.enabled && !ipMatchesAllowlist(yourIp, body.entries)
      && yourIp !== '127.0.0.1' && yourIp !== '::1') {
      return res.status(400).json({
        error: `Your current IP (${yourIp || 'unknown'}) is not in the list — saving would lock you out. Add it first.`,
      });
    }

    const prev = await loadIpAllowlist({ fresh: true });
    const config = await saveIpAllowlist(body, req.user.id);

    await writeAudit({
      entityType: 'app_settings',
      entityId: null,
      action: 'SETTINGS_UPDATE',
      previousValue: { enabled: prev.enabled, entries: prev.entries },
      newValue: { enabled: config.enabled, entries: config.entries },
      metadata: { setting: 'ip_allowlist' },
      userId: req.user.id,
      req,
    });

    res.json({ config, your_ip: yourIp, bypass_active: process.env.IP_ALLOWLIST_BYPASS === '1' });
  } catch (e) {
    next(e);
  }
});

export default router;
