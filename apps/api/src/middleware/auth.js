import { supabaseAdmin, supabaseAsUser } from '../lib/supabase.js';
import { enrichProfileSiteKey } from '../lib/profile-site.js';

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);
  try {
    const { data: { user }, error } = await supabaseAsUser(token).auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      return res.status(401).json({ error: 'Profile not found' });
    }

    if (!profile.is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    req.user = user;
    req.profile = await enrichProfileSiteKey(profile);
    req.token = token;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.profile) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.profile.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}
