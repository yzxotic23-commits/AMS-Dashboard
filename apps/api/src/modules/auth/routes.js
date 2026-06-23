import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(1),
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const uname = username.toLowerCase();

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('email, is_active')
      .eq('username', uname)
      .single();

    if (error || !profile?.is_active) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return res.status(500).json({ error: 'Auth is not configured on the server' });
    }

    const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: profile.email, password }),
    });

    const session = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
      user: session.user,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user, profile: req.profile });
});

export default router;
