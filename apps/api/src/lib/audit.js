import { supabaseAdmin } from './supabase.js';

export async function writeAudit({
  entityType,
  entityId,
  action,
  previousValue,
  newValue,
  metadata,
  userId,
  req,
}) {
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    entity_type: entityType,
    entity_id: entityId || null,
    action,
    previous_value: previousValue ?? null,
    new_value: newValue ?? null,
    metadata: metadata ?? null,
    user_id: userId || null,
    ip_address: req?.ip || req?.headers?.['x-forwarded-for'] || null,
    user_agent: req?.headers?.['user-agent'] || null,
  });
  if (error) console.error('[Audit] write failed:', error.message);
}

export function auditMiddleware(entityType, action) {
  return (req, _res, next) => {
    req._audit = { entityType, action };
    next();
  };
}
