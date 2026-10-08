#!/usr/bin/env node
/**
 * Weekly backup health report to Slack: nightly runs over the last 7 days plus what is
 * actually sitting in the AMS-Backups Shared Drive. Catches the silent case where the
 * nightly job stops running altogether (no failure alert would fire).
 *   GITHUB_TOKEN, GITHUB_REPOSITORY  provided by Actions
 *   GDRIVE_ACCESS_TOKEN, GDRIVE_FOLDER_ID
 *   ALERT_SLACK_WEBHOOK_URL
 */
const DAYS = 7;
const STALE_HOURS = 36;

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GDRIVE_ACCESS_TOKEN, GDRIVE_FOLDER_ID, ALERT_SLACK_WEBHOOK_URL } = process.env;
if (!ALERT_SLACK_WEBHOOK_URL) throw new Error('ALERT_SLACK_WEBHOOK_URL is required');

async function getJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url.split('?')[0]} → ${res.status} ${await res.text()}`);
  return res.json();
}

const since = new Date(Date.now() - DAYS * 86400000);
const { workflow_runs: runs = [] } = await getJson(
  `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/db-backup.yml/runs?per_page=100&created=>=${since.toISOString().slice(0, 10)}`,
  GITHUB_TOKEN,
);
const finished = runs.filter((r) => r.status === 'completed' && new Date(r.created_at) >= since);
const wibDate = (iso) => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 10);
// Manual re-runs can add extra runs, so health is counted in nights with a good backup.
const succeeded = new Set(finished.filter((r) => r.conclusion === 'success').map((r) => wibDate(r.created_at))).size;
const failed = finished.filter((r) => r.conclusion !== 'success').length;

const q = encodeURIComponent(`'${GDRIVE_FOLDER_ID}' in parents and name contains 'ams-backup-' and trashed = false`);
const { files = [] } = await getJson(
  `https://www.googleapis.com/drive/v3/files?q=${q}&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=1000&orderBy=createdTime desc&fields=files(name,createdTime,size)`,
  GDRIVE_ACCESS_TOKEN,
);
const latest = files[0];
const latestAgeHours = latest ? (Date.now() - new Date(latest.createdTime).getTime()) / 3600000 : Infinity;

const wib = (iso) =>
  `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))} WIB`;
const mb = (bytes) => `${(Number(bytes) / 1048576).toFixed(1)} MB`;

const problems = [];
if (succeeded < DAYS) problems.push(`Only *${succeeded} of ${DAYS}* nights had a successful backup this week.`);
if (latestAgeHours > STALE_HOURS) problems.push(`The newest backup in Drive is older than ${STALE_HOURS} hours.`);

const details = [
  ['Nights backed up (last 7 days)', `${succeeded} of ${DAYS}`],
  ['Failed runs', failed],
  ['Latest backup', latest ? `${latest.name} · ${mb(latest.size)} · ${wib(latest.createdTime)}` : 'none found'],
  ['Backups in Drive', `${files.length} (kept 30 days)`],
  ['Restore drill', 'Runs automatically after every backup'],
];

const blocks = [
  { type: 'header', text: { type: 'plain_text', text: problems.length ? '⚠️ Weekly backup report: needs attention' : '🗄️ Weekly backup report', emoji: true } },
  ...(problems.length ? [{ type: 'section', text: { type: 'mrkdwn', text: problems.join('\n') } }] : []),
  { type: 'section', text: { type: 'mrkdwn', text: details.map(([k, v]) => `•  *${k}:*  ${v}`).join('\n') } },
];

const res = await fetch(ALERT_SLACK_WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: `AMS: weekly backup report (${succeeded}/${DAYS} nights backed up)`, blocks }),
});
if (!res.ok) throw new Error(`Slack webhook → ${res.status} ${await res.text()}`);
console.log(`Report sent: ${succeeded}/${DAYS} nights backed up, ${files.length} backups in Drive`);
