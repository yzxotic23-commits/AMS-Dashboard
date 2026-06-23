import { supabaseAdmin } from './supabase.js';

export const TICKET_SCREENSHOT_BUCKET = 'ticket-screenshots';
const MAX_BYTES = 4 * 1024 * 1024;
const SIGNED_URL_TTL_SEC = 60 * 60;

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i;

let bucketReady = null;

export async function ensureTicketScreenshotBucket() {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
    if (listErr) throw new Error(listErr.message || 'Cannot list storage buckets');
    if (buckets?.some((b) => b.id === TICKET_SCREENSHOT_BUCKET || b.name === TICKET_SCREENSHOT_BUCKET)) {
      return;
    }
    const { error } = await supabaseAdmin.storage.createBucket(TICKET_SCREENSHOT_BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    if (error && !/already exists/i.test(error.message || '')) {
      throw new Error(error.message || 'Failed to create ticket-screenshots bucket');
    }
  })();
  return bucketReady;
}

export function parseScreenshotDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = DATA_URL_RE.exec(raw);
  if (!match) {
    throw new Error('Upload a JPEG, PNG, or WebP screenshot');
  }
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Screenshot file is empty');
  if (buffer.length > MAX_BYTES) {
    throw new Error('Screenshot must be under 4 MB');
  }
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return { buffer, contentType, ext };
}

export async function uploadTicketScreenshot({ accountId, reviewId, dataUrl }) {
  await ensureTicketScreenshotBucket();
  const { buffer, contentType, ext } = parseScreenshotDataUrl(dataUrl);
  const path = `${accountId}/${reviewId}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(TICKET_SCREENSHOT_BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message || 'Screenshot upload failed');

  return path;
}

export async function resolveScreenshotUrl(stored) {
  const value = String(stored || '').trim();
  if (!value || value === 'upload://pending' || value === 'upload://demo') return null;
  if (value.startsWith('data:image/')) return value;

  const { data, error } = await supabaseAdmin.storage
    .from(TICKET_SCREENSHOT_BUCKET)
    .createSignedUrl(value, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function screenshotUrlsByReviewIds(reviewIds) {
  const ids = [...new Set((reviewIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data: reviews, error } = await supabaseAdmin
    .from('ip_gate_reviews')
    .select('id, phone_ip_screenshot_url')
    .in('id', ids);
  if (error) throw error;

  const map = new Map();
  await Promise.all((reviews || []).map(async (review) => {
    const url = await resolveScreenshotUrl(review.phone_ip_screenshot_url);
    if (url) map.set(review.id, url);
  }));
  return map;
}
