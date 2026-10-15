import { Router } from 'express';
import { z } from 'zod';
import pg from 'pg';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { circuitBreaker } from '../../lib/circuitBreaker.js';
import { requireExport } from '../../lib/exportAccess.js';
import {
  enrichProfilesSiteKey,
  normalizeProfileBrands,
  normalizeSiteKey,
} from '../../lib/profile-site.js';

const router = Router();
router.use(authenticate);

const brandEnum = z.enum(['SBMY', 'JMMY', 'STMY', 'PP', 'FWSG', 'WBSG', 'M24SG']);
const brandsSchema = z.array(brandEnum).optional();

const createSchema = z.object({
  password: z.string().min(8),
  full_name: z.string().min(1),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  role: z.enum(['admin', 'operator', 'business', 'reviewer']).default('operator'),
  site_key: z.enum(['my', 'pp', 'all']).default('my'),
  brands: brandsSchema,
});

const patchSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(['admin', 'operator', 'business', 'reviewer']).optional(),
  site_key: z.enum(['my', 'pp', 'all']).optional(),
  brands: brandsSchema,
  is_active: z.boolean().optional(),
  can_offboard: z.boolean().optional(),
  in_operator_roster: z.boolean().optional(),
  tg_shooter_owner: z.string().trim().max(80).nullable().optional(),
  tg_currencies: z.array(z.string().trim().min(2).max(10)).max(10).optional(),
  password: z.string().min(8).optional(),
});

const offboardSchema = z.object({
  reason: z.string().trim().min(3, 'Reason is required').max(200),
});

function resolveBrandsForRole(role, brands) {
  const list = normalizeProfileBrands(role, brands);
  if (role === 'business' && list.length === 0) {
    throw new Error('Business users must have at least one brand assigned');
  }
  if (role !== 'business') return [];
  return list;
}

function authEmailForUsername(username) {
  return `${username.toLowerCase()}@ams.internal`;
}

function authHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
}

async function findAuthUserByEmail(email) {
  const url = process.env.SUPABASE_URL;
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`List users failed: ${res.status}`);
  const data = await res.json();
  return (data.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

/**
 * Locking must take effect immediately: ban the auth user so refresh tokens stop
 * working, and drop existing sessions. Unlocking lifts the ban.
 */
async function setAuthAccess(userId, active) {
  const url = process.env.SUPABASE_URL;
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ ban_duration: active ? 'none' : '876000h' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.message || `Could not ${active ? 'unban' : 'ban'} auth user`);
  }
  if (active || !process.env.DATABASE_URL) return;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query('DELETE FROM auth.sessions WHERE user_id = $1', [userId]);
  } finally {
    await client.end().catch(() => {});
  }
}

async function loadLastSignIns() {
  const map = new Map();
  const url = process.env.SUPABASE_URL;
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: authHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    const users = data.users || [];
    for (const u of users) map.set(u.id, u.last_sign_in_at || null);
    if (users.length < 200) break;
  }
  return map;
}

function userAuditSummary(profile) {
  return {
    username: profile.username,
    full_name: profile.full_name,
    role: profile.role,
    site_key: profile.site_key,
    brands: profile.brands || [],
    is_active: profile.is_active,
    can_offboard: Boolean(profile.can_offboard),
    in_operator_roster: Boolean(profile.in_operator_roster),
    tg_shooter_owner: profile.tg_shooter_owner || null,
    tg_currencies: profile.tg_currencies || [],
  };
}

async function findProfileByUsername(username) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, username')
    .eq('username', username.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateProfilePg(client, id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (fields.full_name != null) {
    sets.push(`full_name = $${i++}`);
    vals.push(fields.full_name);
  }
  if (fields.role != null) {
    sets.push(`role = $${i++}::user_role`);
    vals.push(fields.role);
  }
  if (fields.site_key != null) {
    sets.push(`site_key = $${i++}`);
    vals.push(fields.site_key);
  }
  if (fields.brands != null) {
    sets.push(`brands = $${i++}::text[]`);
    vals.push(fields.brands);
  }
  if (fields.is_active != null) {
    sets.push(`is_active = $${i++}`);
    vals.push(fields.is_active);
  }
  if (fields.can_offboard != null) {
    sets.push(`can_offboard = $${i++}`);
    vals.push(fields.can_offboard);
  }
  if (fields.in_operator_roster != null) {
    sets.push(`in_operator_roster = $${i++}`);
    vals.push(fields.in_operator_roster);
  }
  if (fields.tg_shooter_owner !== undefined) {
    sets.push(`tg_shooter_owner = $${i++}`);
    vals.push(fields.tg_shooter_owner);
  }
  if (fields.tg_currencies != null) {
    sets.push(`tg_currencies = $${i++}::text[]`);
    vals.push(fields.tg_currencies);
  }
  if (fields.password_hash != null) {
    sets.push(`password_hash = $${i++}`);
    vals.push(fields.password_hash);
  }
  sets.push('updated_at = NOW()');
  vals.push(id);
  await client.query(`UPDATE profiles SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

async function upsertProfilePg(client, row) {
  await client.query(
    `INSERT INTO profiles (id, email, username, full_name, role, site_key, brands, is_active, password_hash)
     VALUES ($1, $2, $3, $4, $5::user_role, $6, $7::text[], $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       username = EXCLUDED.username,
       full_name = EXCLUDED.full_name,
       role = EXCLUDED.role,
       site_key = EXCLUDED.site_key,
       brands = EXCLUDED.brands,
       is_active = EXCLUDED.is_active,
       password_hash = COALESCE(EXCLUDED.password_hash, profiles.password_hash),
       updated_at = NOW()`,
    [
      row.id, row.email, row.username, row.full_name, row.role, row.site_key,
      row.brands || [], row.is_active, row.password_hash,
    ],
  );
}

// GET /users — staff list (admin)
async function listStaff() {
  const [{ data, error }, lastSignIns] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, email, username, full_name, role, site_key, brands, is_active, can_offboard, in_operator_roster, tg_shooter_owner, tg_currencies, created_at, updated_at')
      .order('created_at', { ascending: false }),
    loadLastSignIns().catch(() => new Map()),
  ]);
  if (error) throw error;
  const rows = await enrichProfilesSiteKey(data || []);
  return rows.map((r) => ({ ...r, last_sign_in_at: lastSignIns.get(r.id) || null }));
}

function requireOffboarding(req, res, next) {
  const p = req.profile;
  if (p?.role === 'admin' || (p?.can_offboard === true && p.role !== 'business')) return next();
  return res.status(403).json({ error: 'You do not have offboarding permission', code: 'OFFBOARD_NOT_ALLOWED' });
}

// GET /users/offboarding — staff list for the resource team (status only, nothing editable)
router.get('/offboarding', requireOffboarding, async (_req, res, next) => {
  try {
    const rows = await listStaff();
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        username: r.username,
        full_name: r.full_name,
        role: r.role,
        site_key: r.site_key,
        is_active: r.is_active,
        last_sign_in_at: r.last_sign_in_at,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/** Offboarding lock/unlock: non-admin targets only (unless the caller is admin), reason required. */
async function setUserActive(req, res, next, active) {
  try {
    const { reason } = offboardSchema.parse(req.body || {});
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (findErr || !existing) return res.status(404).json({ error: 'User not found' });
    if (existing.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own account' });
    }
    if (existing.role === 'admin' && req.profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin accounts can only be locked or unlocked by an admin' });
    }
    if (existing.is_active === active) {
      return res.status(409).json({ error: active ? 'Account is already active' : 'Account is already locked' });
    }

    await setAuthAccess(existing.id, active);
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id, username, full_name, role, site_key, brands, is_active, can_offboard')
      .single();
    if (error) throw error;

    await writeAudit({
      entityType: 'profile',
      entityId: existing.id,
      action: 'USER_UPDATE',
      previousValue: userAuditSummary(existing),
      newValue: userAuditSummary(data),
      metadata: { kind: active ? 'user_unlock' : 'user_lock', changed: ['is_active'], via: 'offboarding', reason },
      userId: req.user.id,
      req,
    });
    res.json({ id: data.id, username: data.username, is_active: data.is_active });
  } catch (e) {
    next(e);
  }
}

router.post('/:id/lock', requireOffboarding, (req, res, next) => setUserActive(req, res, next, false));
router.post('/:id/unlock', requireOffboarding, (req, res, next) => setUserActive(req, res, next, true));

router.use(requireRole('admin'));

router.get('/', async (_req, res, next) => {
  try {
    res.json({ data: await listStaff() });
  } catch (e) {
    next(e);
  }
});

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /users/export — staff list CSV for the monthly reconciliation (no passwords)
router.get('/export', requireExport, async (req, res, next) => {
  try {
    const rows = await listStaff();
    const header = ['Username', 'Full name', 'Role', 'Site', 'Brands', 'Status', 'Created', 'Last login'];
    const lines = rows.map((r) => [
      r.username,
      r.full_name,
      r.role,
      r.site_key,
      (r.brands || []).join(' '),
      r.is_active ? 'Active' : 'Locked',
      r.created_at ? String(r.created_at).slice(0, 10) : '',
      r.last_sign_in_at ? String(r.last_sign_in_at).slice(0, 16).replace('T', ' ') : 'Never',
    ].map(csvCell).join(','));

    await writeAudit({
      entityType: 'profile',
      entityId: null,
      action: 'EXPORT',
      metadata: { export: 'user_list', rows: rows.length },
      userId: req.user.id,
      req,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ams-users-${stamp}.csv"`);
    res.send(`\uFEFF${[header.join(','), ...lines].join('\n')}\n`);
  } catch (e) {
    next(e);
  }
});

// POST /users — create staff (Supabase Auth + profiles)
router.post('/', async (req, res, next) => {
  const dbUrl = process.env.DATABASE_URL;
  let pgClient = null;
  try {
    const body = createSchema.parse(req.body);
    const username = body.username.toLowerCase();
    const email = authEmailForUsername(username);
    const siteKey = normalizeSiteKey(body.role, body.site_key);
    const brands = resolveBrandsForRole(body.role, body.brands);
    const url = process.env.SUPABASE_URL;

    const existingProfile = await findProfileByUsername(username);
    let authUser = existingProfile?.id
      ? { id: existingProfile.id, email: existingProfile.email || email }
      : await findAuthUserByEmail(email);
    if (authUser) {
      const resetRes = await fetch(`${url}/auth/v1/admin/users/${authUser.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ password: body.password, email_confirm: true, ban_duration: 'none' }),
      });
      if (!resetRes.ok) throw new Error('Could not reset existing auth user password');
    } else {
      const createRes = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          email,
          password: body.password,
          email_confirm: true,
          user_metadata: {
            full_name: body.full_name,
            role: body.role,
            username,
          },
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error(created.msg || created.message || `Create user failed: ${createRes.status}`);
      }
      authUser = created;
    }

    if (!authUser?.id) throw new Error('Could not resolve auth user id');

    const profileRow = {
      id: authUser.id,
      email,
      username,
      full_name: body.full_name,
      role: body.role,
      site_key: siteKey,
      brands,
      is_active: true,
      password_hash: body.password,
    };

    const { error: upsertErr } = await supabaseAdmin.from('profiles').upsert(profileRow);
    if (upsertErr) throw upsertErr;

    if (dbUrl) {
      pgClient = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await pgClient.connect();
      await upsertProfilePg(pgClient, profileRow);
    }

    await writeAudit({
      entityType: 'profile',
      entityId: authUser.id,
      action: 'USER_CREATE',
      newValue: { username, role: body.role, site_key: siteKey, brands },
      userId: req.user.id,
      req,
    });

    res.status(201).json(profileRow);
  } catch (e) {
    next(e);
  } finally {
    if (pgClient) await pgClient.end().catch(() => {});
  }
});

// PATCH /users/:id — update role / reset password
router.patch('/:id', async (req, res, next) => {
  const dbUrl = process.env.DATABASE_URL;
  let pgClient = null;
  try {
    const body = patchSchema.parse(req.body);
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (findErr || !existing) return res.status(404).json({ error: 'User not found' });

    const isSelf = req.params.id === req.user.id;
    if (isSelf && body.is_active === false) {
      return res.status(400).json({ error: 'You cannot lock your own account' });
    }
    if (isSelf && body.role != null && body.role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }

    const activeChanged = body.is_active != null && body.is_active !== existing.is_active;
    if (activeChanged) await setAuthAccess(req.params.id, body.is_active);

    if (body.password) {
      const url = process.env.SUPABASE_URL;
      const resetRes = await fetch(`${url}/auth/v1/admin/users/${req.params.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ password: body.password, email_confirm: true }),
      });
      if (!resetRes.ok) throw new Error('Password reset failed');
    }

    const nextRole = body.role ?? existing.role;
    const patch = {
      ...(body.full_name != null ? { full_name: body.full_name } : {}),
      ...(body.role != null ? { role: body.role } : {}),
      ...(body.is_active != null ? { is_active: body.is_active } : {}),
      ...(body.can_offboard != null ? { can_offboard: body.can_offboard } : {}),
      ...(body.in_operator_roster != null ? { in_operator_roster: body.in_operator_roster } : {}),
      ...(body.tg_shooter_owner !== undefined ? { tg_shooter_owner: body.tg_shooter_owner || null } : {}),
      ...(body.tg_currencies != null
        ? { tg_currencies: [...new Set(body.tg_currencies.map((c) => c.toUpperCase()))].sort() }
        : {}),
      ...(body.password ? { password_hash: body.password } : {}),
    };
    if (body.site_key != null || body.role != null) {
      patch.site_key = normalizeSiteKey(nextRole, body.site_key ?? existing.site_key);
    }
    if (body.brands != null || body.role != null) {
      patch.brands = resolveBrandsForRole(
        nextRole,
        body.brands != null ? body.brands : existing.brands,
      );
    }

    let data;
    if (Object.keys(patch).length > 0) {
      const { data: updated, error } = await supabaseAdmin
        .from('profiles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select('id, email, username, full_name, role, site_key, brands, is_active, can_offboard, in_operator_roster, tg_shooter_owner, tg_currencies, created_at, updated_at')
        .single();
      if (error) throw error;
      data = updated;

      if (dbUrl) {
        pgClient = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
        await pgClient.connect();
        await updateProfilePg(pgClient, req.params.id, patch);
      }
    } else {
      data = existing;
    }

    const before = userAuditSummary(existing);
    const after = userAuditSummary(data);
    const changed = Object.keys(before).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    if (changed.length || body.password) {
      let kind = 'profile_update';
      if (activeChanged) kind = body.is_active ? 'user_unlock' : 'user_lock';
      else if (changed.includes('role')) kind = 'role_change';
      else if (changed.includes('can_offboard')) kind = 'permission_change';
      else if (body.password && !changed.length) kind = 'password_reset';
      await writeAudit({
        entityType: 'profile',
        entityId: existing.id,
        action: 'USER_UPDATE',
        previousValue: before,
        newValue: after,
        metadata: { kind, changed, ...(body.password ? { password_reset: true } : {}) },
        userId: req.user.id,
        req,
      });
    }

    const [enriched] = await enrichProfilesSiteKey([data]);
    res.json(enriched);
  } catch (e) {
    next(e);
  } finally {
    if (pgClient) await pgClient.end().catch(() => {});
  }
});

// DELETE /users/:id — remove staff account (not self)
router.delete('/:id', circuitBreaker('delete'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const { data: existing, error: findErr } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .eq('id', req.params.id)
      .single();
    if (findErr || !existing) return res.status(404).json({ error: 'User not found' });

    const url = process.env.SUPABASE_URL;
    const delRes = await fetch(`${url}/auth/v1/admin/users/${req.params.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!delRes.ok) {
      const body = await delRes.json().catch(() => ({}));
      throw new Error(body.msg || body.message || `Delete user failed: ${delRes.status}`);
    }

    await writeAudit({
      entityType: 'profile',
      entityId: existing.id,
      action: 'USER_DELETE',
      previousValue: { username: existing.username },
      userId: req.user.id,
      req,
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
