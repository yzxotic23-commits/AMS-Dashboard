import { z } from 'zod';
import { createCrudRouter } from '../../lib/crudRouter.js';

const createSchema = z.object({
  device_name: z.string().min(1),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
  notes: z.string().optional().nullable(),
});

export default createCrudRouter({
  table: 'devices',
  entityType: 'device',
  createSchema,
  updateSchema: createSchema.partial(),
  searchFields: ['device_name', 'brand', 'serial_number'],
});
