import './loadEnv.js';
import app from './app.js';
import { ensureTicketScreenshotBucket } from './lib/ticketScreenshots.js';

const PORT = parseInt(process.env.API_PORT || '4000', 10);
const HOST = process.env.API_HOST || '0.0.0.0';

// API entry — restart picks up route changes under src/
const startedAt = new Date().toISOString();
const buildTag = 'sim-bound-fix-v5';
app.listen(PORT, HOST, () => {
  console.log(`[AMS API] http://${HOST}:${PORT} (started ${startedAt}, ${buildTag})`);
  console.log(`[AMS API] Health: http://localhost:${PORT}/api/v1/health`);
  console.log('[AMS API] FeedFlow engine starts on first /bridge/* request (not on API boot).');
  ensureTicketScreenshotBucket().catch((e) => {
    console.error('[AMS] ticket-screenshots bucket check failed:', e.message);
  });
});

