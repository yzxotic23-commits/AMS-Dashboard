# AMS Project — Account Management System

Platform terpusat untuk mengelola lifecycle akun WhatsApp, device, SIM, IP, ticketing, dan audit.

**Stack:** React + Tailwind + React Query + Express + Supabase PostgreSQL

## Setup

1. `cp .env.example .env` — fill Supabase credentials from Dashboard → Project Settings → API
2. Set `VITE_DEMO_MODE=false` (default in `.env.example`)
3. Run SQL: `supabase/migrations/001_initial_schema.sql` in Supabase SQL Editor
4. Verify: `npm run setup:supabase`
5. Create master admin: `npm run create:admin`
6. Optional sample data: `npm run seed:sample`

## Run

```bash
npm install
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/api/v1/health
- **FeedFlow engine** starts automatically with the API (no second terminal)

Set `WSAF_AUTO_START=false` in `.env` only if you run WSAF manually.

## Deploy to Vercel (web + API on one domain)

1. Import repo [AMS-Dashboard](https://github.com/yzxotic23-commits/AMS-Dashboard) on [vercel.com](https://vercel.com)
2. **Root Directory:** leave empty (repo root)
3. Vercel reads `vercel.json` automatically — no extra build settings needed
4. Add **Environment Variables** (Production + Preview):

| Variable | Scope | Notes |
|----------|-------|-------|
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_ANON_KEY` | Server | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Service role (API only) |
| `VITE_SUPABASE_URL` | Build | Same as SUPABASE_URL |
| `VITE_SUPABASE_ANON_KEY` | Build | Same as anon key |
| `VITE_DEMO_MODE` | Build | `false` |
| `WSAF_AUTO_START` | Server | `false` on Vercel |

5. Deploy → open `https://<your-app>.vercel.app`
6. Health check: `https://<your-app>.vercel.app/api/v1/health`

**What works online:** login, Control Center, Register, Tickets, Governance, User management, all Supabase-backed CRUD.

**What stays local:** WhatsApp QR / pairing (FeedFlow engine on operator PC, port 47821). Activation page opens but linking needs local FeedFlow.
