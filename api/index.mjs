/**
 * Vercel serverless entry — mounts the Express API at /api/v1/*
 * Local dev still uses apps/api/src/index.js (port 4000).
 */
import '../apps/api/src/loadEnv.js';
import app from '../apps/api/src/app.js';
import { ensureTicketScreenshotBucket } from '../apps/api/src/lib/ticketScreenshots.js';

ensureTicketScreenshotBucket().catch((e) => {
  console.warn('[AMS] ticket-screenshots bucket check:', e.message);
});

export default app;
