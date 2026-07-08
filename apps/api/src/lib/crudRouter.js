import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from './supabase.js';
import { writeAudit } from './audit.js';
import { parsePagination, paginatedResponse } from './pagination.js';

export function createCrudRouter({
  table,
  entityType,
  createSchema,
  updateSchema,
  searchFields = [],
  listOrder = { column: 'updated_at', ascending: false },
}) {
  const router = Router();
  router.use(authenticate);
  router.use(requireRole('admin', 'operator'));

  router.get('/', async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      let q = supabaseAdmin.from(table).select('*', { count: 'exact' });

      if (req.query.status) q = q.eq('status', req.query.status);
      if (req.query.search && searchFields.length) {
        const or = searchFields.map((f) => `${f}.ilike.%${req.query.search}%`).join(',');
        q = q.or(or);
      }

      const { data, error, count } = await q
        .order(listOrder.column, { ascending: listOrder.ascending, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      res.json(paginatedResponse(data, count || 0, page, limit));
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin.from(table).select('*').eq('id', req.params.id).single();
      if (error) throw error;
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const { data, error } = await supabaseAdmin.from(table).insert(body).select().single();
      if (error) throw error;
      await writeAudit({ entityType, entityId: data.id, action: 'CREATE', newValue: data, userId: req.profile.id, req });
      res.status(201).json(data);
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateSchema.parse(req.body);
      const { data: current } = await supabaseAdmin.from(table).select('*').eq('id', req.params.id).single();
      const { data, error } = await supabaseAdmin.from(table).update(body).eq('id', req.params.id).select().single();
      if (error) throw error;
      await writeAudit({ entityType, entityId: data.id, action: 'UPDATE', previousValue: current, newValue: data, userId: req.profile.id, req });
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const { data: current } = await supabaseAdmin.from(table).select('*').eq('id', req.params.id).single();
      const { error } = await supabaseAdmin.from(table).delete().eq('id', req.params.id);
      if (error) throw error;
      await writeAudit({ entityType, entityId: req.params.id, action: 'DELETE', previousValue: current, userId: req.profile.id, req });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
