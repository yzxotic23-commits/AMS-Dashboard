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
