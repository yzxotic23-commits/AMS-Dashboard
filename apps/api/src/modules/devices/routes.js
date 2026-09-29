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
  site_key: z.enum(['my', 'pp']).optional().nullable(),
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

function lockedProfileSite(profile) {
  const sk = profile?.site_key;
  return sk === 'my' || sk === 'pp' ? sk : null;
}

// Operators scoped to one site can only create devices on that site.
router.post('/', (req, res, next) => {
  const opSite = lockedProfileSite(req.profile);
  if (opSite && req.body && typeof req.body === 'object') {
    req.body.site_key = opSite;
  }
  next();
});

// Site is fixed once set: renaming (e.g. PP-SB-005 → MYR-SB-023) must not move the device.
router.patch('/:id', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || !('site_key' in req.body)) return next();
    const { data: current, error } = await supabaseAdmin
      .from('devices')
      .select('site_key')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (current?.site_key === 'my' || current?.site_key === 'pp') {
      delete req.body.site_key;
    }
    next();
  } catch (e) {
    next(e);
  }
});

router.use(crud);

export default router;
