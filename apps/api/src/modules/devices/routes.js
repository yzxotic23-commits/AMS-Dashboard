import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { createCrudRouter } from '../../lib/crudRouter.js';
import { ensureDeviceCapacity } from '../../lib/deviceCapacity.js';

const createSchema = z.object({
  device_name: z.string().min(1),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
  notes: z.string().optional().nullable(),
});

const crud = createCrudRouter({
  table: 'devices',
  entityType: 'device',
  createSchema,
  updateSchema: createSchema.partial(),
  searchFields: ['device_name', 'brand', 'serial_number'],
});

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator'));

router.post('/ensure-capacity', async (req, res, next) => {
  try {
    const site_key = z.enum(['my', 'pp']).parse(req.body?.site_key);
    const result = await ensureDeviceCapacity(supabaseAdmin, site_key);
    if (result.expanded) {
      await writeAudit({
        entityType: 'device',
        entityId: 'bulk',
        action: 'DEVICE_EXPAND',
        newValue: { site_key, created: result.created },
        userId: req.profile.id,
        req,
      });
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.use(crud);

export default router;
