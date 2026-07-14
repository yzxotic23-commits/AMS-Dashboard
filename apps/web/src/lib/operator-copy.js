/** Operator-facing status labels and toast copy — keep wording short and consistent. */

export const RECOVERY_STATUS = {
  need: 'Pending',
  doing: 'Recovering',
  ok: 'Recovered',
  fail: 'Failed',
};

export const ACCOUNT_STATUS = {
  nurturing: 'Nurturing',
  standby: 'Standby',
  inuse: 'In Use',
  recovering: 'Recovering',
  banned: 'Banned',
  empty: 'Empty',
};

export const NURT_STATUS = {
  manual: 'Manual Nurturing',
  readyScan: 'Ready to scan',
  auto: 'System Monitoring',
};

const FAIL_REASON_SHORT = {
  'SIM issue (expired / not topped up / deactivated)': 'SIM issue',
  'Code received but recovery still failed': 'Code failed',
  'Permanently banned by platform': 'Perm ban',
  Other: 'Other',
};

function shortFailReason(reason) {
  return FAIL_REASON_SHORT[reason] || reason;
}

export const toastCopy = {
  recoveryStarted: (name) => `${name} · recovering`,
  recoveryDone: (name, elapsed) => `${name} · recovered · back to nurturing · ${elapsed}`,
  recoveryDoneStandby: (name, elapsed) => `${name} · recovered · standby · ${elapsed}`,
  recoveryFailed: (name, elapsed, reason) =>
    `${name} · failed · ${elapsed} · ${shortFailReason(reason)}`,

  nurturingConfirmIp: () => 'Confirm IP setup and login first',
  nurturingScanIn: (name) => `${name} · auto nurture · day 4`,
  nurturingGraduated: (name) => `${name} · standby pool`,
  nurturingBanned: (name) => `${name} · banned · see Recovery`,

  activationLinked: (name) => `${name} · WhatsApp linked`,
  activationDone: (name) => `${name} · activated · Nurturing`,

  registerOk: (phone, name) => `${phone} · registered · ${name || 'new account'}`,
  registerFail: (phone) => `${phone} · registration failed`,

  ipInUse: () => 'Cannot delete — IP in use',
  ipDeleted: () => 'IP deleted',
  ipSelectFirst: () => 'Select IPs first',
  ipSetActive: (n) => `${n} IP · active`,
  ipSetInactive: (n) => `${n} IP · inactive`,
  ipBulkDelete: (done, blocked) => {
    if (blocked > 0) return `${done} deleted · ${blocked} skipped (in use)`;
    if (done === 1) return 'IP deleted';
    return `${done} IPs deleted`;
  },
  ipSaved: () => 'IP updated',
  ipCreated: (addr) => `${addr} · added to ledger`,
  ipImported: (imported, skipped, errorCount) => {
    let msg = `${imported} IP${imported === 1 ? '' : 's'} imported`;
    if (skipped > 0) msg += ` · ${skipped} skipped`;
    if (errorCount > 0) msg += ` · ${errorCount} row errors`;
    return msg;
  },

  preparedAdded: (phone) => `${phone} · added to register queue`,
  preparedDeleted: (phone) => `${phone} · removed from queue`,
  preparedDeleteBlocked: () => 'Cannot delete — number linked to an account',

  simTopUp: (phone, date) => `${phone} · top-up · ${date}`,

  feedingStarted: () => 'Feeding · started',
  feedingStopped: () => 'Feeding · stopped',
  feedingError: (msg) => {
    const short = (msg || 'failed').split('.')[0].slice(0, 48);
    return `Feeding · ${short}`;
  },
};
