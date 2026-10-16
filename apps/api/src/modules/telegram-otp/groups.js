import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { writeAudit } from '../../lib/audit.js';
import { requireExport } from '../../lib/exportAccess.js';
import { isSessionReady, purgeGroupScans } from './store.js';

/**
 * Group scan for GCS accounts (admin only while in trial).
 * A brand's master list is derived from every scanned GCS account of that brand: a group is in
 * the master when at least one of those accounts is admin there and an invite link is known.
 */
const router = Router();
router.use(requireRole('admin'));

const PAGE = 1000;
const SCAN_FIELDS = 'id, account_id, status, progress_done, progress_total, group_count, error, created_at, started_at, finished_at';

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function loadGcsAccounts() {
  const { data, error } = await supabaseAdmin
    .from('tg_accounts')
    .select('id, phone, profile, brand, currency, status')
    .eq('pool', 'gcs')
    .eq('enabled', true)
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Latest scan per account, and the latest finished one (which owns the stored group list). */
async function loadScans(accountIds) {
  if (!accountIds.length) return { latest: new Map(), lastDone: new Map() };
  const rows = await fetchAll(() => supabaseAdmin
    .from('tg_group_scans')
    .select(SCAN_FIELDS)
    .in('account_id', accountIds)
    .order('created_at', { ascending: false }));
  const latest = new Map();
  const lastDone = new Map();
  for (const r of rows) {
    if (!latest.has(r.account_id)) latest.set(r.account_id, r);
    if (r.status === 'done' && !lastDone.has(r.account_id)) lastDone.set(r.account_id, r);
  }
  return { latest, lastDone };
}

function buildMasters(accounts, groupRows) {
  const brandOf = new Map(accounts.map((a) => [a.id, a.brand || '']));
  const masters = new Map();
  for (const g of groupRows) {
    if (!g.is_admin || !g.invite_link) continue;
    const brand = brandOf.get(g.account_id);
    if (brand == null) continue;
    if (!masters.has(brand)) masters.set(brand, new Set());
    masters.get(brand).add(g.group_id);
  }
  return masters;
}

function compareAccount(groups, master) {
  const joined = new Set(groups.map((g) => g.group_id));
  let junk = 0;
  let notAdmin = 0;
  for (const g of groups) {
    if (!master.has(g.group_id)) junk += 1;
    else if (!g.is_admin) notAdmin += 1;
  }
  let missing = 0;
  for (const id of master) if (!joined.has(id)) missing += 1;
  return { junk, not_admin: notAdmin, missing };
}

/** GET /telegram-otp/groups/accounts — GCS accounts with their last scan and master comparison. */
router.get('/accounts', async (_req, res, next) => {
  try {
    await purgeGroupScans();
    const accounts = await loadGcsAccounts();
    const ids = accounts.map((a) => a.id);
    const [groupRows, { latest, lastDone }] = await Promise.all([
      ids.length
        ? fetchAll(() => supabaseAdmin
          .from('tg_account_groups')
          .select('account_id, group_id, is_admin, invite_link')
          .in('account_id', ids)
          .order('account_id')
          .order('group_id'))
        : [],
      loadScans(ids),
    ]);
    const masters = buildMasters(accounts, groupRows);
    const byAccount = new Map();
    for (const g of groupRows) {
      if (!byAccount.has(g.account_id)) byAccount.set(g.account_id, []);
      byAccount.get(g.account_id).push(g);
    }

    const data = accounts.map((a) => {
      const done = lastDone.get(a.id) || null;
      const groups = byAccount.get(a.id) || [];
      const master = masters.get(a.brand || '') || new Set();
      return {
        ...a,
        scan: latest.get(a.id) || null,
        scanned_at: done?.finished_at || null,
        group_count: done ? groups.length : null,
        admin_count: done ? groups.filter((g) => g.is_admin).length : null,
        master_count: master.size,
        ...(done ? compareAccount(groups, master) : { junk: null, not_admin: null, missing: null }),
      };
    });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/** The account's groups (classified against its brand master) and the master groups it has not joined. */
async function loadAccountDetail(accountId) {
  const { data: account, error } = await supabaseAdmin
    .from('tg_accounts')
    .select('id, phone, profile, brand, currency, status, pool, enabled')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!account || account.pool !== 'gcs') return null;

  const { data: brandAccounts, error: baErr } = await supabaseAdmin
    .from('tg_accounts')
    .select('id, profile')
    .eq('pool', 'gcs')
    .eq('enabled', true)
    .eq('brand', account.brand || '');
  if (baErr) throw baErr;
  const brandIds = (brandAccounts || []).map((a) => a.id);
  if (!brandIds.includes(account.id)) brandIds.push(account.id);

  const rows = await fetchAll(() => supabaseAdmin
    .from('tg_account_groups')
    .select('account_id, group_id, group_name, member_count, is_admin, is_owner, invite_link, scanned_at')
    .in('account_id', brandIds)
    .order('account_id')
    .order('group_id'));

  const master = new Map();
  for (const g of rows) {
    if (!g.is_admin || !g.invite_link) continue;
    const cur = master.get(g.group_id);
    if (!cur || (g.scanned_at > cur.scanned_at)) master.set(g.group_id, g);
  }

  const own = rows.filter((g) => g.account_id === account.id);
  const joined = new Set(own.map((g) => g.group_id));
  const groups = own
    .map((g) => ({
      group_id: g.group_id,
      group_name: g.group_name,
      member_count: g.member_count,
      is_admin: g.is_admin,
      is_owner: g.is_owner,
      invite_link: g.invite_link || master.get(g.group_id)?.invite_link || null,
      state: !master.has(g.group_id) ? 'junk' : g.is_admin ? 'ok' : 'not_admin',
    }))
    .sort((a, b) => String(a.group_name || '').localeCompare(String(b.group_name || '')));
  const missing = [...master.values()]
    .filter((g) => !joined.has(g.group_id))
    .map((g) => ({
      group_id: g.group_id,
      group_name: g.group_name,
      member_count: g.member_count,
      invite_link: g.invite_link,
      state: 'missing',
    }))
    .sort((a, b) => String(a.group_name || '').localeCompare(String(b.group_name || '')));

  const { data: scan, error: scanErr } = await supabaseAdmin
    .from('tg_group_scans')
    .select(SCAN_FIELDS)
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (scanErr) throw scanErr;

  return { account, scan: scan || null, master_count: master.size, groups, missing };
}

/** GET /telegram-otp/groups/accounts/:id — the account's groups, classified, plus master groups it is missing. */
router.get('/accounts/:id', async (req, res, next) => {
  try {
    const detail = await loadAccountDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'GCS account not found' });
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

const STATE_LABELS = { ok: 'Admin', not_admin: 'Not admin', junk: 'Junk', missing: 'Missing' };

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /telegram-otp/groups/accounts/:id/export — CSV of joined + missing groups for one account. */
router.get('/accounts/:id/export', requireExport, async (req, res, next) => {
  try {
    const detail = await loadAccountDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'GCS account not found' });
    const rows = [...detail.groups, ...detail.missing];
    const header = ['State', 'Group name', 'Group ID', 'Members', 'Admin', 'Owner', 'Invite link'];
    const lines = rows.map((g) => [
      STATE_LABELS[g.state] || g.state,
      g.group_name,
      g.group_id,
      g.member_count,
      g.state === 'missing' ? '' : g.is_admin ? 'Yes' : 'No',
      g.state === 'missing' ? '' : g.is_owner ? 'Yes' : 'No',
      g.invite_link,
    ].map(csvCell).join(','));

    await writeAudit({
      entityType: 'tg_account',
      entityId: detail.account.id,
      action: 'EXPORT',
      metadata: {
        export: 'telegram_groups',
        account: detail.account.id,
        brand: detail.account.brand || null,
        account_label: detail.account.profile || detail.account.id,
        rows: rows.length,
      },
      userId: req.profile.id,
      req,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tg-groups-${detail.account.id}-${stamp}.csv"`);
    res.send(`\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`);
  } catch (e) {
    next(e);
  }
});

const queueSchema = z.object({ account_id: z.string().trim().min(1).max(120) });

/** POST /telegram-otp/groups/scans — queue a scan; reuses the open one for the same account. */
router.post('/scans', async (req, res, next) => {
  try {
    const { account_id: accountId } = queueSchema.parse(req.body);
    const { data: account, error } = await supabaseAdmin
      .from('tg_accounts')
      .select('id, pool, status, enabled')
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!account || !account.enabled || account.pool !== 'gcs') {
      return res.status(404).json({ error: 'GCS account not found' });
    }
    if (!isSessionReady(account)) {
      return res.status(409).json({ error: `Friday's session for this account is ${account.status || 'not connected'} — it cannot scan groups.` });
    }

    await purgeGroupScans();
    const { data: open, error: openErr } = await supabaseAdmin
      .from('tg_group_scans')
      .select(SCAN_FIELDS)
      .eq('account_id', accountId)
      .in('status', ['queued', 'running'])
      .limit(1)
      .maybeSingle();
    if (openErr) throw openErr;
    if (open) return res.json(open);

    const { data: created, error: insErr } = await supabaseAdmin
      .from('tg_group_scans')
      .insert({ account_id: accountId, requested_by: req.profile.id })
      .select(SCAN_FIELDS)
      .single();
    if (insErr) throw insErr;
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

/** POST /telegram-otp/groups/scans/:id/cancel — stop a queued or running scan; the last list stays. */
router.post('/scans/:id/cancel', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tg_group_scans')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .in('status', ['queued', 'running'])
      .select(SCAN_FIELDS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'This scan has already finished' });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

export default router;
