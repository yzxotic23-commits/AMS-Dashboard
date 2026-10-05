import { syncResourceBindings } from './resourceBindings.js';
import { mergeOperatorNotes } from './accountMeta.js';
import { parseRecoveryNotes, serializeRecoveryNotes } from './accountRecovery.js';
import { assertTransition } from './stateMachine.js';

const RETIRE_REASON = 'SIM unlinked — account retired (1 account = 1 SIM)';

/**
 * One account lives on one SIM, so unlinking the SIM retires the account: it becomes
 * RECYCLED and frees its device slot. Status history (incl. past bans) is kept for KPIs,
 * and the device name is snapshotted so ban analytics still attribute old bans to it.
 */
async function retireAccountPatch(supabaseAdmin, account) {
  if (account.status === 'IN_USE') {
    const err = new Error('Account is In Use — return it to Standby before unlinking its SIM');
    err.status = 409;
    throw err;
  }
  if (account.status !== 'RECYCLED') assertTransition(account.status, 'RECYCLED');

  let deviceName = null;
  if (account.device_id) {
    const { data } = await supabaseAdmin
      .from('devices')
      .select('device_name')
      .eq('id', account.device_id)
      .maybeSingle();
    deviceName = data?.device_name || null;
  }
  const opNotes = mergeOperatorNotes(account.notes, {
    retired_at: new Date().toISOString(),
    retired_reason: 'sim_unlinked',
    ...(deviceName ? { retired_device_name: deviceName } : {}),
  });
  const rec = parseRecoveryNotes(account.notes);
  return {
    sim_id: null,
    device_id: null,
    status: 'RECYCLED',
    notes: rec ? serializeRecoveryNotes(opNotes, rec) : opNotes,
  };
}

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
      accountPatch = await retireAccountPatch(supabaseAdmin, account);
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

    if (accountPatch.status === 'RECYCLED' && account.status !== 'RECYCLED') {
      await supabaseAdmin.from('account_status_history').insert({
        account_id: account.id,
        from_status: account.status,
        to_status: 'RECYCLED',
        reason: RETIRE_REASON,
        changed_by: userId || null,
      });
    }
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
