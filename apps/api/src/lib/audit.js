import { supabaseAdmin } from './supabase.js';
import { clientIp } from './clientIp.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const validId = entityId && UUID_RE.test(String(entityId)) ? entityId : null;
  const meta = entityId && !validId
    ? { ...(metadata || {}), entity_ref: String(entityId) }
    : metadata;
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    entity_type: entityType,
    entity_id: validId,
    action,
    previous_value: previousValue ?? null,
    new_value: newValue ?? null,
    metadata: meta ?? null,
    user_id: userId || null,
    ip_address: req ? clientIp(req) || null : null,
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
