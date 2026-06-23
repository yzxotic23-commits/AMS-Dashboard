import { supabaseAdmin } from './supabase.js';

/** Keep device / sim / ip reverse FKs in sync when an account is assigned. */
export async function syncResourceBindings(accountId, { device_id, sim_id, ip_id }, prev = {}) {
  if (prev.device_id && prev.device_id !== device_id) {
    await supabaseAdmin.from('devices')
      .update({ current_account_id: null })
      .eq('id', prev.device_id)
      .eq('current_account_id', accountId);
  }
  if (device_id && device_id !== prev.device_id) {
    await supabaseAdmin.from('devices')
      .update({ current_account_id: accountId })
      .eq('id', device_id);
  }

  if (prev.sim_id && prev.sim_id !== sim_id) {
    await supabaseAdmin.from('sims')
      .update({ current_account_id: null })
      .eq('id', prev.sim_id)
      .eq('current_account_id', accountId);
  }
  if (sim_id && sim_id !== prev.sim_id) {
    await supabaseAdmin.from('sims')
      .update({ current_account_id: accountId })
      .eq('id', sim_id);
  }

  if (prev.ip_id && prev.ip_id !== ip_id) {
    const stillUsed = await countAccountsOnIp(prev.ip_id, accountId);
    if (stillUsed === 0) {
      await supabaseAdmin.from('ips')
        .update({ assigned_account_id: null })
        .eq('id', prev.ip_id);
    }
  }
  if (ip_id && ip_id !== prev.ip_id) {
    await supabaseAdmin.from('ips')
      .update({ assigned_account_id: accountId })
      .eq('id', ip_id);
  }
}

async function countAccountsOnIp(ipId, excludeAccountId) {
  let q = supabaseAdmin.from('accounts').select('id', { count: 'exact', head: true }).eq('ip_id', ipId);
  if (excludeAccountId) q = q.neq('id', excludeAccountId);
  const { count } = await q;
  return count || 0;
}

export async function recordInitialAssignments(accountId, { device_id, sim_id, ip_id }, userId) {
  const tables = [
    { field: 'device_id', table: 'account_device_history', col: 'device_id' },
    { field: 'sim_id', table: 'account_sim_history', col: 'sim_id' },
    { field: 'ip_id', table: 'account_ip_history', col: 'ip_id' },
  ];
  for (const { field, table, col } of tables) {
    const id = { device_id, sim_id, ip_id }[field];
    if (id) {
      await supabaseAdmin.from(table).insert({
        account_id: accountId,
        [col]: id,
        assigned_by: userId,
      });
    }
  }
}

export async function bumpIpRisk(ipId) {
  if (!ipId) return;
  const { data } = await supabaseAdmin.from('ips').select('risk_count').eq('id', ipId).single();
  const next = (data?.risk_count || 0) + 1;
  const patch = { risk_count: next };
  if (next >= 8) patch.status = 'FLAGGED';
  await supabaseAdmin.from('ips').update(patch).eq('id', ipId);
}
