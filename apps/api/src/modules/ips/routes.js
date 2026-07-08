import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { createCrudRouter } from '../../lib/crudRouter.js';
import { dedupeImportRows, parseIpCsv } from '../../lib/ipImport.js';

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

const crud = createCrudRouter({
  table: 'ips',
  entityType: 'ip',
  createSchema,
  updateSchema: createSchema.partial(),
  searchFields: ['ip_address', 'proxy_provider', 'country'],
  listOrder: { column: 'proxy_provider', ascending: true },
});

const router = Router();
router.use(authenticate);
router.use(requireRole('admin', 'operator'));

const importSchema = z.object({
  csv: z.string().min(1),
  skipDuplicates: z.boolean().optional().default(true),
});

const INSERT_CHUNK = 50;
const LOOKUP_CHUNK = 100;

async function loadExistingAddresses(addresses) {
  const existing = new Set();
  for (let i = 0; i < addresses.length; i += LOOKUP_CHUNK) {
    const chunk = addresses.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('ips')
      .select('ip_address')
      .in('ip_address', chunk);
    if (error) throw error;
    (data || []).forEach((row) => {
      existing.add(String(row.ip_address || '').trim().toLowerCase());
    });
  }
  return existing;
}

router.post('/import', async (req, res, next) => {
  try {
    const { csv, skipDuplicates } = importSchema.parse(req.body);
    const { rows, errors: parseErrors } = parseIpCsv(csv);

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'No valid rows to import',
        imported: 0,
        skipped: [],
        errors: parseErrors,
      });
    }

    let uniqueRows = rows;
    let skipped = [];

    if (skipDuplicates) {
      const addresses = [...new Set(rows.map((row) => row.ip_address.trim()))];
      const existingAddresses = await loadExistingAddresses(addresses);
      const deduped = dedupeImportRows(rows, existingAddresses);
      uniqueRows = deduped.unique;
      skipped = deduped.skipped;
    }

    if (uniqueRows.length === 0) {
      return res.json({
        imported: 0,
        skipped,
        errors: parseErrors,
      });
    }

    const inserted = [];
    for (let i = 0; i < uniqueRows.length; i += INSERT_CHUNK) {
      const chunk = uniqueRows.slice(i, i + INSERT_CHUNK);
      const { data, error } = await supabaseAdmin
        .from('ips')
        .insert(chunk)
        .select('id, ip_address, proxy_provider');
      if (error) throw error;
      inserted.push(...(data || []));
    }

    await writeAudit({
      entityType: 'ip',
      entityId: 'bulk',
      action: 'BULK_IMPORT',
      newValue: {
        imported: inserted.length,
        skipped: skipped.length,
        errors: parseErrors.length,
      },
      metadata: {
        sample: inserted.slice(0, 5).map((row) => row.ip_address),
      },
      userId: req.profile.id,
      req,
    });

    res.status(201).json({
      imported: inserted.length,
      skipped,
      errors: parseErrors,
      data: inserted,
    });
  } catch (e) {
    next(e);
  }
});

router.use(crud);

export default router;
