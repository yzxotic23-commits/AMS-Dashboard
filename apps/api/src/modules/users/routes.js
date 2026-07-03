import { Router } from 'express';
import { z } from 'zod';
import pg from 'pg';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import {
  enrichProfilesSiteKey,
  normalizeSiteKey,
} from '../../lib/profile-site.js';

const router = Router();
router.use(authenticate);

router.use(requireRole('admin'));

const createSchema = z.object({
  password: z.string().min(8),
  full_name: z.string().min(1),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  role: z.enum(['admin', 'operator', 'business', 'reviewer']).default('operator'),
  site_key: z.enum(['my', 'pp', 'all']).default('my'),
});

const patchSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(['admin', 'operator', 'business', 'reviewer']).optional(),
  site_key: z.enum(['my', 'pp', 'all']).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

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
  if (fields.is_active != null) {
    sets.push(`is_active = $${i++}`);
    vals.push(fields.is_active);
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
    `INSERT INTO profiles (id, email, username, full_name, role, site_key, is_active, password_hash)
     VALUES ($1, $2, $3, $4, $5::user_role, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       username = EXCLUDED.username,
       full_name = EXCLUDED.full_name,
       role = EXCLUDED.role,
       site_key = EXCLUDED.site_key,
       is_active = EXCLUDED.is_active,
       password_hash = COALESCE(EXCLUDED.password_hash, profiles.password_hash),
       updated_at = NOW()`,
    [row.id, row.email, row.username, row.full_name, row.role, row.site_key, row.is_active, row.password_hash],
  );
}

// GET /users — staff list (admin)
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, username, full_name, role, site_key, is_active, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = await enrichProfilesSiteKey(data || []);
    res.json({ data: rows });
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
    const url = process.env.SUPABASE_URL;

    const existingProfile = await findProfileByUsername(username);
    let authUser = existingProfile?.id
      ? { id: existingProfile.id, email: existingProfile.email || email }
      : await findAuthUserByEmail(email);
    if (authUser) {
      const resetRes = await fetch(`${url}/auth/v1/admin/users/${authUser.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ password: body.password, email_confirm: true }),
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
      newValue: { username, role: body.role, site_key: siteKey },
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
      ...(body.password ? { password_hash: body.password } : {}),
    };
    if (body.site_key != null || body.role != null) {
      patch.site_key = normalizeSiteKey(nextRole, body.site_key ?? existing.site_key);
    }

    let data;
    if (Object.keys(patch).length > 0) {
      const { data: updated, error } = await supabaseAdmin
        .from('profiles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select('id, email, username, full_name, role, site_key, is_active, created_at, updated_at')
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

    const [enriched] = await enrichProfilesSiteKey([data]);
    res.json(enriched);
  } catch (e) {
    next(e);
  } finally {
    if (pgClient) await pgClient.end().catch(() => {});
  }
});

// DELETE /users/:id — remove staff account (not self)
router.delete('/:id', async (req, res, next) => {
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
      oldValue: { username: existing.username },
      userId: req.user.id,
      req,
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
