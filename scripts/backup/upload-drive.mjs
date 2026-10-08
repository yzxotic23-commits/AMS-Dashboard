#!/usr/bin/env node
/**
 * Uploads an encrypted backup to the AMS-Backups Shared Drive, then trashes backups older
 * than RETENTION_DAYS (Shared Drive trash empties itself after 30 days).
 *   GDRIVE_ACCESS_TOKEN  OAuth token for the uploader service account (Content manager on the
 *                        Shared Drive), minted in CI via Workload Identity Federation (no key file)
 *   GDRIVE_FOLDER_ID     Shared Drive ID (or a folder inside it)
 *   RETENTION_DAYS       default 30
 * Usage: node upload-drive.mjs backup-out/ams-backup-*.tar.gz.enc
 */
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const MIN_KEEP = 7;

const file = process.argv[2];
const folderId = process.env.GDRIVE_FOLDER_ID;
const token = process.env.GDRIVE_ACCESS_TOKEN;
if (!file) throw new Error('Usage: upload-drive.mjs <backup file>');
if (!folderId || !token) throw new Error('GDRIVE_ACCESS_TOKEN and GDRIVE_FOLDER_ID are required');

async function drive(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url.split('?')[0]} → ${res.status} ${await res.text()}`);
  return res;
}

const name = basename(file);
const { size } = await stat(file);

// Resumable upload: one session, no 5 MB multipart limit.
const session = await drive(token, `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size) },
  body: JSON.stringify({ name, parents: [folderId], mimeType: 'application/octet-stream' }),
});
const { id } = await (
  await drive(token, session.headers.get('location'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    body: await readFile(file),
  })
).json();
const uploaded = await (
  await drive(token, `${DRIVE}/files/${id}?supportsAllDrives=true&fields=id,name,size`)
).json();
if (Number(uploaded.size) !== size) {
  throw new Error(`Uploaded size ${uploaded.size} does not match local size ${size}`);
}
console.log(`Uploaded ${uploaded.name} (${size} bytes) → Drive file ${uploaded.id}`);

const q = encodeURIComponent(`'${folderId}' in parents and name contains 'ams-backup-' and trashed = false`);
const { files = [] } = await (
  await drive(
    token,
    `${DRIVE}/files?q=${q}&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=1000&orderBy=createdTime desc&fields=files(id,name,createdTime)`,
  )
).json();

const cutoff = Date.now() - RETENTION_DAYS * 86400000;
const expired = files.slice(MIN_KEEP).filter((f) => new Date(f.createdTime).getTime() < cutoff);
for (const f of expired) {
  await drive(token, `${DRIVE}/files/${f.id}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  console.log(`Trashed ${f.name} (older than ${RETENTION_DAYS} days)`);
}
console.log(`Drive now holds ${files.length - expired.length} backups`);
