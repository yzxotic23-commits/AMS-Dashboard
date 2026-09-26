import { syncResourceBindings } from './resourceBindings.js';

export function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function phonesMatch(a, b) {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 9 && db.length >= 9) return da.slice(-9) === db.slice(-9);
  return false;
}

export function syncIssueType(account, sim) {
  if (!account) return 'orphan_sim';
  if (!sim) return account.sim_id ? 'missing_sim' : 'ok';
  if (!account.sim_id) return 'unlinked_sim_match';
  if (account.sim_id !== sim.id) return 'wrong_sim_link';
  if (!phonesMatch(account.phone_number, sim.phone_number)) return 'phone_mismatch';
  if (sim.current_account_id && sim.current_account_id !== account.id) return 'sim_bound_elsewhere';
  return 'ok';
}

export function buildPhoneSyncRow(account, sim) {
  const issue = syncIssueType(account, sim);
  return {
    account_id: account?.id || null,
    account_name: account?.account_name || '—',
    account_phone: account?.phone_number || '',
    account_status: account?.status || '',
    sim_id: sim?.id || null,
    sim_phone: sim?.phone_number || '',
    sim_carrier: sim?.carrier || '',
    issue,
    needs_action: issue !== 'ok',
  };
}

export async function applyPhoneSync(supabaseAdmin, { account, sim, action, userId }) {
  if (!account) {
    const err = new Error('Account not found');
    err.status = 404;
    throw err;
  }

  const prev = { device_id: account.device_id, sim_id: account.sim_id, ip_id: account.ip_id };
  let accountPatch = {};
  let simPatch = {};

  if (action === 'copy_sim_to_account') {
    if (!sim?.phone_number) {
      const err = new Error('SIM has no phone number');
      err.status = 400;
      throw err;
    }
    accountPatch = { phone_number: sim.phone_number, sim_id: sim.id };
    simPatch = { current_account_id: account.id };
  } else if (action === 'copy_account_to_sim') {
    if (!account.phone_number) {
      const err = new Error('Account has no phone number');
      err.status = 400;
      throw err;
    }
    if (!sim) {
      const err = new Error('SIM not found for sync');
      err.status = 400;
      throw err;
    }
    simPatch = { phone_number: account.phone_number, current_account_id: account.id };
    accountPatch = { sim_id: sim.id };
  } else if (action === 'link_sim') {
    if (!sim) {
      const err = new Error('SIM not found');
      err.status = 404;
      throw err;
    }
    accountPatch = {
      sim_id: sim.id,
      phone_number: account.phone_number || sim.phone_number,
    };
    simPatch = {
      current_account_id: account.id,
      ...(account.phone_number && !phonesMatch(sim.phone_number, account.phone_number)
        ? { phone_number: account.phone_number }
        : {}),
      ...(!account.phone_number && sim.phone_number ? {} : {}),
    };
    if (!account.phone_number && sim.phone_number) {
      accountPatch.phone_number = sim.phone_number;
    }
  } else if (action === 'unlink_sim') {
    if (!account.sim_id && !sim) {
      const err = new Error('No SIM linked to this account');
      err.status = 400;
      throw err;
    }
    // Clear account→sim only when this SIM is the bound one (or no SIM row given).
    const clearAccountLink = !sim || !account.sim_id || account.sim_id === sim.id;
    if (clearAccountLink) {
      accountPatch = { sim_id: null };
    }
    if (sim) {
      simPatch = { current_account_id: null };
    }
  } else {
    const err = new Error('Invalid sync action');
    err.status = 400;
    throw err;
  }

  let updatedAccount = account;
  if (Object.keys(accountPatch).length) {
    const { data, error: accErr } = await supabaseAdmin
      .from('accounts')
      .update(accountPatch)
      .eq('id', account.id)
      .select('*')
      .single();
    if (accErr) throw accErr;
    updatedAccount = data;

    await syncResourceBindings(account.id, {
      device_id: updatedAccount.device_id,
      sim_id: updatedAccount.sim_id,
      ip_id: updatedAccount.ip_id,
    }, prev);
  }

  if (sim && Object.keys(simPatch).length) {
    const { error: simErr } = await supabaseAdmin
      .from('sims')
      .update(simPatch)
      .eq('id', sim.id);
    if (simErr) throw simErr;
  }

  return {
    account: updatedAccount,
    sim_id: action === 'unlink_sim' ? null : (sim?.id || updatedAccount.sim_id),
    action,
    userId,
  };
}
