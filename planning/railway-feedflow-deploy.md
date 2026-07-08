# Deploy FeedFlow (WSAF) to Railway — trial guide

## 1. Push WSAF changes to GitHub

From `Whatsapp Auto Feeding/WSAF` (repo WSAF-BO):

```bash
git add Dockerfile railway.toml .dockerignore server/desktop-api.js
git commit -m "Add Railway deploy config and PORT/CSP for cloud hosting."
git push origin main
```

## 2. Railway — new service

1. https://railway.com/dashboard → **+ New** → **GitHub Repository**
2. Select **WSAF-BO**
3. Railway detects `Dockerfile` + `railway.toml` automatically

## 3. Volume (session WhatsApp — important)

1. Service → **Volumes** → **Add Volume**
2. Mount path: `/app/data`
3. Redeploy after attach

Without this, WhatsApp sessions are lost on every redeploy.

## 4. Environment variables (Railway → Variables)

| Variable | Example | Required |
|----------|---------|----------|
| `OPENAI_API_KEY` | `sk-...` | Yes (or Codex setup) |
| `AI_PROVIDER_PRIMARY` | `openai` | Yes |
| `AMS_FRAME_ORIGINS` | `https://ams-dashboard-weld.vercel.app` | Yes |
| `DESKTOP_FEEDING` | `1` | Auto in Docker |

Railway sets `PORT` automatically — no need to set manually.

## 5. Public domain

1. Service → **Settings** → **Networking** → **Generate Domain**
2. Copy URL e.g. `https://wsaf-bo-production.up.railway.app`
3. Test: `https://YOUR-URL/api/health` → `{"ok":true,"version":"..."}`

## 6. Connect AMS on Vercel

Vercel → Project AMS → **Settings → Environment Variables**:

| Variable | Value |
|----------|-------|
| `WSAF_BRIDGE_URL` | `https://YOUR-RAILWAY-URL` (no trailing slash) |
| `WSAF_AUTO_START` | `false` |
| `VITE_WSAF_BRIDGE_URL` | `https://YOUR-RAILWAY-URL` |

Redeploy Vercel (Production).

## 7. Verify

1. `https://ams-dashboard-weld.vercel.app/feedflow` → Refresh → **Live**
2. Open Railway URL in browser → FeedFlow console loads
3. Link WhatsApp via AMS Activation/Nurturing

## Trial cost note

One always-on Railway service ≈ **$3–5/month** from your $5 trial credit.

## Security

Railway URL is public — anyone with the link can hit the engine API.
Restrict access later with Railway private networking or IP allowlist if needed.
