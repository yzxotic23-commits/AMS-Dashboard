import { z } from 'zod';
import { createCrudRouter } from '../../lib/crudRouter.js';

const createSchema = z.object({
  proxy_provider: z.string().optional().nullable(),
  proxy_type: z.string().optional().nullable(),
  ip_address: z.string().min(1),
  port: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'FLAGGED', 'RETIRED']).optional(),
  notes: z.string().optional().nullable(),
});

export default createCrudRouter({
  table: 'ips',
  entityType: 'ip',
  createSchema,
  updateSchema: createSchema.partial(),
  searchFields: ['ip_address', 'proxy_provider', 'country'],
});
