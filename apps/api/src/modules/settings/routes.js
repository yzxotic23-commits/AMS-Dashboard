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

export default router;
