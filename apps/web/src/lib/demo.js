/** Demo mode — preview UI without real Supabase/API */
import {
  IPS_LEDGER, SIMS_LEDGER, AUDIT_LOG, DEVICES_LIST, FEEDING_AUDIT_LOG,
  DEMO_ACCOUNT_SEED, DEMO_REG_LOGS, TICKETS_SEED,
} from './wireframe-data';
import { serializeAccountNotes, parseOperatorMeta } from './account-operator-meta';
import { buildBanRecords, aggregateBanStats } from './ban-analytics';
import { serializeRecoveryNotes, recoveryOnBanDefaults, parseRecoveryMeta } from './account-recovery-meta';
import {
  parseTicketMeta, serializeTicketDescription, proxyFromIp, proxyMatch, stageFromStatus,
} from './ticket-meta';

export const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true';

export const DEMO_PROFILE = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'demo@ams.local',
  full_name: 'Demo Admin',
  role: 'admin',
  is_active: true,
};

export const DEMO_SESSION = {
  access_token: 'demo-token',
  user: { id: DEMO_PROFILE.id, email: DEMO_PROFILE.email },
};

const MS_DAY = 86_400_000;

const ALLOWED_TRANSITIONS = {
  REGISTERING: ['NURTURING', 'RECYCLED'],
  NURTURING: ['AVAILABLE', 'BANNED', 'RECYCLED'],
  AVAILABLE: ['IN_USE', 'NURTURING', 'RECYCLED'],
  IN_USE: ['LOGGED_OUT', 'BANNED', 'AVAILABLE'],
  LOGGED_OUT: ['NURTURING', 'RECOVERING', 'RECYCLED'],
  BANNED: ['RECOVERING', 'RECYCLED'],
  RECOVERING: ['NURTURING', 'AVAILABLE', 'RECYCLED'],
  RECYCLED: [],
};

function startedForDay(day) {
  return new Date(Date.now() - (day - 1) * MS_DAY).toISOString();
}

function deviceIdForName(name) {
  return DEVICES_LIST.find((d) => d.device_name === name)?.id ?? null;
}

function opNotes(siteKey, extra = {}, humanNote = '') {
  return serializeAccountNotes({
    site_key: siteKey,
    channel: extra.channel || '',
    owner: extra.owner || '',
    prepared_telco: extra.prepared_telco || '',
    linked_override: Boolean(extra.linked_override),
    nurturing_phase: extra.nurturing_phase || 'manual',
    nurturing_started_at: extra.nurturing_started_at,
    human_note: extra.human_note || humanNote,
  }, extra.human_note || humanNote);
}

function buildSeedAccounts() {
  return DEMO_ACCOUNT_SEED.map((entry) => {
    const isNurturing = entry.status === 'NURTURING';
    const nurturingMeta = isNurturing ? {
      nurturing_phase: entry.nurturing_phase || 'manual',
      nurturing_started_at: startedForDay(entry.nurturing_day || 1),
      linked_override: true,
      human_note: entry.nurturing_phase === 'auto' ? 'Engine monitored' : 'Device farm phase',
    } : {
      human_note: entry.status === 'REGISTERING' ? 'Awaiting activation link' : '',
    };

    let notes = opNotes(entry.site_key, {
      channel: entry.channel,
      owner: entry.owner,
      prepared_telco: entry.prepared_telco,
      ...nurturingMeta,
    });

    if (entry.recovery) {
      notes = serializeRecoveryNotes(notes, entry.recovery);
    }

    const regDay = entry.nurturing_day || 3;

    return {
      id: entry.id,
      account_name: entry.account_name,
      phone_number: entry.phone_number,
      status: entry.status,
      device_id: deviceIdForName(entry.device),
      sim_id: entry.sim_id || null,
      ip_id: entry.ip_id || null,
      wsaf_slot: entry.wsaf_slot ?? null,
      notes,
      registration_date: isNurturing
        ? startedForDay(regDay)
        : new Date(Date.now() - MS_DAY * regDay).toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

let demoAccounts = buildSeedAccounts();
let demoIps = IPS_LEDGER.map((r) => ({ ...r }));
let demoRegLogs = DEMO_REG_LOGS.map((r) => ({ ...r }));
let demoStatusHistory = {};

function seedStatusHistory() {
  demoStatusHistory = {};
  demoAccounts.forEach((a) => {
    demoStatusHistory[a.id] = [{
      id: `sh-${a.id}-0`,
      account_id: a.id,
      from_status: null,
      to_status: a.status,
      reason: 'Account created (seed)',
      changed_at: a.registration_date || a.updated_at,
      profiles: { full_name: DEMO_PROFILE.full_name },
    }];
  });

  const banTransitions = [
    { id: 'acc-006', reason: '[manual] Device / SIM issue' },
    { id: 'acc-012', reason: '[auto] Permanently banned by platform' },
  ];
  banTransitions.forEach(({ id, reason }) => {
    if (!demoStatusHistory[id]) return;
    demoStatusHistory[id].unshift({
      id: `sh-${id}-ban`,
      account_id: id,
      from_status: 'NURTURING',
      to_status: 'BANNED',
      reason,
      changed_at: new Date(Date.now() - 86400000).toISOString(),
      profiles: { full_name: DEMO_PROFILE.full_name },
    });
  });

  ['acc-005', 'rec2'].forEach((id) => {
    if (!demoStatusHistory[id]) return;
    demoStatusHistory[id].unshift({
      id: `sh-${id}-rec`,
      account_id: id,
      from_status: 'BANNED',
      to_status: 'RECOVERING',
      reason: 'Recovery started',
      changed_at: new Date(Date.now() - 43200000).toISOString(),
      profiles: { full_name: DEMO_PROFILE.full_name },
    });
  });
}
seedStatusHistory();

function pushStatusHistory(accountId, fromStatus, toStatus, reason) {
  if (!demoStatusHistory[accountId]) demoStatusHistory[accountId] = [];
  demoStatusHistory[accountId].unshift({
    id: `sh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    account_id: accountId,
    from_status: fromStatus,
    to_status: toStatus,
    reason,
    changed_at: new Date().toISOString(),
    profiles: { full_name: DEMO_PROFILE.full_name },
  });
}

function syncDemoIpsFromSeed() {
  const byId = new Map(demoIps.map((r) => [r.id, r]));
  demoIps = IPS_LEDGER.map((seed) => ({ ...seed, ...byId.get(seed.id) }));
}
let demoSims = SIMS_LEDGER.map((r) => ({ ...r }));
let demoDevices = DEVICES_LIST.map((r) => ({ ...r }));

function syncDemoDevicesFromSeed() {
  const byId = new Map(demoDevices.map((r) => [r.id, r]));
  demoDevices = DEVICES_LIST.map((seed) => ({ ...seed, ...byId.get(seed.id) }));
}
let demoFeedingRunning = false;
let demoFeedingStarting = false;

function wireProxy(w) {
  if (!w) return null;
  return { ip_address: w.addr, port: w.port, username: w.user, password: w.pw };
}

function ticketStatusFromStage(stage) {
  if (stage === 'posted') return 'IN_PROGRESS';
  if (stage === 'done') return 'RESOLVED';
  return 'OPEN';
}

function buildSeedTickets() {
  const all = [...TICKETS_SEED.my, ...TICKETS_SEED.pp];
  return all.map((w, i) => {
    const bind = wireProxy(w.bind);
    const shot = wireProxy(w.shot);
    const meta = {
      site_key: w.site,
      delivery_stage: w.state,
      link_code: w.code || '',
      shot_proxy: shot,
      bind_proxy_override: bind,
      channel: w.ch,
      device_name: w.dev,
      account_display: w.acct,
      phone_display: w.phone,
      ip_gate_review_id: w.state === 'submitted' ? `igr-${w.id}` : null,
      reject_reason: '',
    };
    return {
      id: `tk-${w.id.toLowerCase()}`,
      ticket_number: w.id,
      title: `Delivery — ${w.acct}`,
      description: serializeTicketDescription('', meta),
      status: ticketStatusFromStage(w.state),
      account_id: null,
      requester_id: DEMO_PROFILE.id,
      created_at: new Date(Date.now() - (all.length - i) * 3600000).toISOString(),
      closed_at: w.state === 'done' ? new Date().toISOString() : null,
    };
  });
}

function buildSeedIpGateReviews(tickets) {
  return tickets
    .filter((t) => {
      const meta = parseTicketMeta(t);
      return meta.delivery_stage === 'submitted' && meta.ip_gate_review_id;
    })
    .map((t) => {
      const meta = parseTicketMeta(t);
      return {
        id: meta.ip_gate_review_id,
        account_id: t.account_id,
        ticket_id: t.id,
        status: 'PENDING',
        submitted_by: DEMO_PROFILE.id,
        phone_ip_screenshot_url: 'upload://demo',
        created_at: t.created_at,
      };
    });
}

function enrichDemoTicket(ticket) {
  const meta = parseTicketMeta(ticket);
  const account = ticket.account_id
    ? enrichAccount(demoAccounts.find((a) => a.id === ticket.account_id))
    : null;
  const ipRow = account?.ip_id ? demoIps.find((i) => i.id === account.ip_id) : null;
  const bind = meta.bind_proxy_override || proxyFromIp(ipRow);
  const shot = meta.shot_proxy || null;
  const delivery_stage = meta.delivery_stage || stageFromStatus(ticket.status);
  const review = meta.ip_gate_review_id
    ? demoIpGateReviews.find((r) => r.id === meta.ip_gate_review_id)
    : null;
  const storedShot = review?.phone_ip_screenshot_url || '';
  const screenshot_url = storedShot.startsWith('data:image/') ? storedShot : null;
  return {
    ...ticket,
    delivery_stage,
    site_key: meta.site_key || 'my',
    link_code: meta.link_code || '',
    shot_proxy: shot,
    bind_proxy: bind,
    ip_match: proxyMatch(bind, shot),
    reject_reason: meta.reject_reason || '',
    channel: meta.channel || '—',
    device_name: meta.device_name || account?.devices?.device_name || '—',
    account_name: meta.account_display || account?.account_name || '—',
    phone_number: meta.phone_display || account?.phone_number || '—',
    ip_gate_review_id: meta.ip_gate_review_id || null,
    screenshot_url,
  };
}

function ticketStatsFromRows(rows) {
  const pending = rows.filter((r) => r.delivery_stage === 'submitted').length;
  const inProg = rows.filter((r) => r.delivery_stage === 'posted').length;
  const done = rows.filter((r) => r.delivery_stage === 'done').length;
  const rejected = rows.filter((r) => r.reject_reason).length;
  const byReason = {};
  rows.filter((r) => r.reject_reason).forEach((r) => {
    const label = r.reject_reason || 'IP mismatch';
    byReason[label] = (byReason[label] || 0) + 1;
  });
  const reasonTotal = rejected || 1;
  const rejReasons = Object.entries(byReason).map(([label, count]) => ({
    label,
    count,
    pct: Math.round((count / reasonTotal) * 100),
  }));
  return {
    pending,
    inProgress: inProg,
    done,
    rejected,
    tkPending: pending,
    tkDone: done,
    tkReject: rejected,
    rejectReasons: rejReasons,
    detail: `${pending} awaiting review · ${inProg} awaiting business confirm · ${done} completed`,
  };
}

let demoTickets = buildSeedTickets();
let demoIpGateReviews = buildSeedIpGateReviews(demoTickets);

function enrichAccount(a) {
  syncDemoIpsFromSeed();
  const device = a.device_id ? demoDevices.find((d) => d.id === a.device_id) : null;
  const sim = a.sim_id ? demoSims.find((s) => s.id === a.sim_id) : null;
  const ip = a.ip_id ? demoIps.find((i) => i.id === a.ip_id) : null;
  return {
    ...a,
    devices: device ? { device_name: device.device_name } : null,
    sims: sim ? { phone_number: sim.phone_number, carrier: sim.carrier, location: sim.location } : null,
    ips: ip ? {
      ip_address: ip.ip_address,
      port: ip.port,
      username: ip.username,
      password: ip.password,
      country: ip.ip_address.startsWith('103.') ? 'MY' : 'PP',
    } : null,
  };
}

function syncIpAssignment(prevId, nextId) {
  syncDemoIpsFromSeed();
  if (prevId && prevId !== nextId) {
    demoIps = demoIps.map((ip) => (
      ip.id === prevId ? { ...ip, in_use: Math.max(0, (ip.in_use || 0) - 1) } : ip
    ));
  }
  if (nextId && prevId !== nextId) {
    demoIps = demoIps.map((ip) => (
      ip.id === nextId ? { ...ip, in_use: (ip.in_use || 0) + 1 } : ip
    ));
  }
  recomputeIpInUse();
}

function recomputeIpInUse() {
  const counts = {};
  demoAccounts.forEach((a) => {
    if (a.ip_id) counts[a.ip_id] = (counts[a.ip_id] || 0) + 1;
  });
  demoIps = demoIps.map((ip) => ({ ...ip, in_use: counts[ip.id] || 0 }));
}

function syncDeviceBinding(prevDeviceId, nextDeviceId, accountId) {
  syncDemoDevicesFromSeed();
  if (prevDeviceId && prevDeviceId !== nextDeviceId) {
    demoDevices = demoDevices.map((d) => (
      d.id === prevDeviceId && d.current_account_id === accountId
        ? { ...d, current_account_id: null }
        : d
    ));
  }
  if (nextDeviceId) {
    demoDevices = demoDevices.map((d) => (
      d.id === nextDeviceId ? { ...d, current_account_id: accountId } : d
    ));
  }
}

function bumpDemoIpRisk(ipId) {
  if (!ipId) return;
  demoIps = demoIps.map((ip) => {
    if (ip.id !== ipId) return ip;
    const risk_count = (ip.risk_count || 0) + 1;
    return {
      ...ip,
      risk_count,
      status: risk_count >= 8 ? 'FLAGGED' : ip.status,
    };
  });
}

recomputeIpInUse();
demoAccounts.forEach((a) => {
  if (a.device_id) syncDeviceBinding(null, a.device_id, a.id);
});

function accountForBanAnalytics(a) {
  const meta = parseOperatorMeta(a);
  const enriched = enrichAccount(a);
  return {
    ...enriched,
    site_key: meta.site_key || 'my',
    channel: meta.channel || '',
  };
}

function demoBanRecords() {
  const accountsById = Object.fromEntries(
    demoAccounts.map((a) => [a.id, accountForBanAnalytics(a)]),
  );
  const history = Object.values(demoStatusHistory).flat();
  return buildBanRecords(history, accountsById);
}

function demoBridgePayload() {
  const slots = [
    { slot: 0, label: 'Account 1', phone: '+60123456789', connected: true, linking: false, feedingActive: demoFeedingRunning },
    { slot: 1, label: 'Account 2', phone: '+60198765432', connected: true, linking: false, feedingActive: demoFeedingRunning },
    { slot: 2, label: 'Account 3', phone: '+60111222333', connected: true, linking: false, feedingActive: demoFeedingRunning },
    { slot: 3, label: 'Account 4', phone: null, connected: false, linking: true, feedingActive: false },
    { slot: 4, label: 'Account 5', phone: '+60144555666', connected: true, linking: false, feedingActive: demoFeedingRunning },
    { slot: 5, label: 'Account 6', phone: '+60177888999', connected: true, linking: false, feedingActive: demoFeedingRunning },
    { slot: 6, label: 'Account 7', phone: '+60199888777', connected: true, linking: false, feedingActive: demoFeedingRunning },
    { slot: 7, label: 'Account 8', phone: null, connected: false, linking: false, feedingActive: false },
  ];
  const slotsFeeding = demoFeedingRunning ? slots.filter((s) => s.feedingActive).length : 0;

  return {
    ok: true,
    reachable: true,
    version: '1.0.29',
    engine: {
      accountCount: 8,
      pairCount: 4,
      feedingRunning: demoFeedingRunning,
      feedingStarting: demoFeedingStarting,
      feedingLaunchPhase: demoFeedingRunning ? 'running' : demoFeedingStarting ? 'prepare' : null,
      slotsOnline: 6,
      slotsOffline: 1,
      slotsFeeding,
      slotsLinking: 1,
      lastFeedingComplete: { at: new Date(Date.now() - 3600000).toISOString(), success: true },
    },
    slots,
    feeding: {
      summary: {
        totalFeedingVolume: demoFeedingRunning ? 44 : 42,
        successVolume: 36,
        restrictVolume: 4,
        bannedVolume: 2,
        successRate: 86,
      },
    },
  };
}

export function getMockResponse(config) {
  const method = (config.method || 'get').toUpperCase();
  const url = (config.url || '').replace(/^\//, '');
  const params = config.params || {};

  if (method === 'GET' && url === 'auth/me') {
    return { user: DEMO_SESSION.user, profile: DEMO_PROFILE };
  }

  if (method === 'GET' && url === 'bridge/summary') {
    return {
      ...demoBridgePayload(),
      boot: {
        autoStart: true,
        state: 'ready',
        managed: true,
        pid: null,
        wsafRoot: '../WSAF',
      },
    };
  }

  if (method === 'GET' && url === 'bridge/status') {
    const payload = demoBridgePayload();
    return {
      ok: true,
      reachable: true,
      accounts: payload.slots.map((s) => ({
        slot: s.slot,
        label: s.label,
        phone: s.phone,
        connected: s.connected,
        linking: s.linking,
        feedingActive: s.feedingActive,
      })),
    };
  }

  if (method === 'POST' && url.startsWith('bridge/connect/')) {
    return { ok: true, demo: true };
  }

  if (method === 'POST' && url === 'bridge/feeding/start') {
    if (demoFeedingRunning || demoFeedingStarting) {
      return { ok: false, error: 'Feeding already running' };
    }
    demoFeedingStarting = true;
    demoFeedingRunning = true;
    demoFeedingStarting = false;
    return { ok: true, demo: true };
  }

  if (method === 'POST' && url === 'bridge/feeding/stop') {
    const wasRunning = demoFeedingRunning;
    demoFeedingRunning = false;
    demoFeedingStarting = false;
    return { ok: true, wasRunning, demo: true };
  }

  if (method === 'GET' && url.startsWith('bridge/audit')) {
    const entries = [...FEEDING_AUDIT_LOG];
    const total = entries.length;
    const success = entries.filter((e) => e.feedingStatus === 'Success').length;
    const restrict = entries.filter((e) => e.feedingStatus === 'Restrict').length;
    const banned = entries.filter((e) => e.feedingStatus === 'Banned').length;
    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    return {
      ok: true,
      total,
      entries,
      summary: {
        totalFeedingVolume: total,
        successVolume: success,
        successRate: pct(success),
        restrictVolume: restrict,
        restrictRate: pct(restrict),
        bannedVolume: banned,
        bannedRate: pct(banned),
        uniqueIpsWithBan: 1,
      },
    };
  }

  if (method === 'GET' && url === 'dashboard') {
    const countStatus = (st) => demoAccounts.filter((a) => a.status === st).length;
    const pendingGate = demoIpGateReviews.filter((r) => r.status === 'PENDING').length;
    const openTickets = demoTickets.filter((t) => t.status !== 'RESOLVED').length;
    return {
      stats: {
        total_accounts: demoAccounts.length,
        available_accounts: countStatus('AVAILABLE'),
        in_use_accounts: countStatus('IN_USE'),
        banned_accounts: countStatus('BANNED'),
        logged_out_accounts: countStatus('LOGGED_OUT'),
        nurturing_accounts: countStatus('NURTURING'),
        registering_accounts: countStatus('REGISTERING'),
        recovering_accounts: countStatus('RECOVERING'),
        total_devices: demoDevices.length,
        total_sims: demoSims.length,
        total_ips: demoIps.length,
        open_tickets: openTickets,
        pending_ip_gate: pendingGate,
      },
      recentActivity: AUDIT_LOG.slice(0, 4).map((a) => ({
        id: a.id,
        action: a.action,
        entity_type: a.entity_type,
        created_at: a.created_at,
      })),
      recentTickets: demoTickets.slice(0, 3).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    };
  }

  if (method === 'GET' && url === 'accounts') {
    recomputeIpInUse();
    let list = [...demoAccounts];
    if (params.status) list = list.filter((a) => a.status === params.status);
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((a) =>
        a.account_name.toLowerCase().includes(q) ||
        (a.phone_number || '').includes(q),
      );
    }
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '20', 10);
    return {
      data: list.map(enrichAccount),
      pagination: { page, limit, total: list.length, totalPages: 1 },
    };
  }

  if (method === 'GET' && /^accounts\/[^/]+$/.test(url)) {
    const id = url.split('/')[1];
    const account = demoAccounts.find((a) => a.id === id);
    if (!account) throw new Error('Account not found');
    return {
      ...enrichAccount(account),
      statusHistory: demoStatusHistory[id] || [],
    };
  }

  if (method === 'POST' && url === 'accounts') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const row = {
      id: `a${Date.now()}`,
      account_name: body.account_name,
      phone_number: body.phone_number || null,
      status: body.status || 'REGISTERING',
      device_id: body.device_id ?? null,
      sim_id: body.sim_id ?? null,
      ip_id: body.ip_id ?? null,
      wsaf_slot: body.wsaf_slot ?? null,
      notes: body.notes || '',
      registration_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    demoAccounts = [row, ...demoAccounts];
    syncIpAssignment(null, row.ip_id);
    syncDeviceBinding(null, row.device_id, row.id);
    pushStatusHistory(row.id, null, row.status, 'Account created');
    return enrichAccount(row);
  }

  if (method === 'PATCH' && url.startsWith('accounts/')) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const prev = demoAccounts.find((a) => a.id === id);
    if (!prev) throw new Error('Account not found');
    demoAccounts = demoAccounts.map((a) => {
      if (a.id !== id) return a;
      return {
        ...a,
        ...body,
        notes: body.notes ?? a.notes,
        updated_at: new Date().toISOString(),
      };
    });
    const row = demoAccounts.find((a) => a.id === id);
    if (body.ip_id !== undefined) syncIpAssignment(prev.ip_id, body.ip_id);
    if (body.device_id !== undefined) syncDeviceBinding(prev.device_id, body.device_id, id);
    if (body.status && body.status !== prev.status) {
      pushStatusHistory(id, prev.status, body.status, body.reason || 'Status updated');
    }
    return enrichAccount(row);
  }

  if (method === 'POST' && /^accounts\/[^/]+\/transition$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const current = demoAccounts.find((a) => a.id === id);
    if (!current) throw new Error('Account not found');
    const allowed = ALLOWED_TRANSITIONS[current.status] || [];
    if (!allowed.includes(body.to_status)) {
      throw new Error(`Invalid state transition: ${current.status} → ${body.to_status}`);
    }
    demoAccounts = demoAccounts.map((a) => (
      a.id === id
        ? { ...a, status: body.to_status, updated_at: new Date().toISOString() }
        : a
    ));
    pushStatusHistory(id, current.status, body.to_status, body.reason || 'State transition');
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'POST' && /^accounts\/[^/]+\/ban$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const current = demoAccounts.find((a) => a.id === id);
    if (!current) throw new Error('Account not found');
    const allowed = ALLOWED_TRANSITIONS[current.status] || [];
    if (!allowed.includes('BANNED')) {
      throw new Error(`Invalid state transition: ${current.status} → BANNED`);
    }
    const banReason = `[${body.stage}] ${body.reason}${body.source ? ` · ${body.source}` : ''}`;
    demoAccounts = demoAccounts.map((a) => (
      a.id === id ? { ...a, status: 'BANNED', updated_at: new Date().toISOString() } : a
    ));
    pushStatusHistory(id, current.status, 'BANNED', banReason);
    bumpDemoIpRisk(current.ip_id);
    const recNotes = serializeRecoveryNotes(current.notes || '', recoveryOnBanDefaults(body.stage, body.reason));
    demoAccounts = demoAccounts.map((a) => (
      a.id === id ? { ...a, status: 'BANNED', notes: recNotes, updated_at: new Date().toISOString() } : a
    ));
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'GET' && url === 'bans/stats') {
    const siteKey = params.site || params.site_key || 'all';
    const records = demoBanRecords();
    const stats = aggregateBanStats(records, { siteKey });
    const poolSize = demoAccounts.filter((a) => a.status !== 'RECYCLED').length;
    const overallPct = poolSize > 0
      ? Math.round((stats.total / poolSize) * 1000) / 10
      : 0;
    const flaggedIps = demoIps
      .filter((ip) => (ip.risk_count || 0) >= stats.badIpThreshold || ip.status === 'FLAGGED')
      .slice(0, 10);
    return { ...stats, overallPct, poolSize, flaggedIps };
  }

  if (method === 'GET' && url === 'bans') {
    let list = demoBanRecords();
    const siteKey = params.site || params.site_key;
    if (siteKey && siteKey !== 'all') list = list.filter((r) => r.site_key === siteKey);
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '50', 10);
    return {
      data: list.slice(0, limit),
      pagination: { page, limit, total: list.length, totalPages: 1 },
    };
  }

  if (method === 'DELETE' && url.startsWith('accounts/')) {
    const id = url.split('/')[1];
    demoAccounts = demoAccounts.filter((a) => a.id !== id);
    return { ok: true };
  }

  if (method === 'GET' && url === 'registrations') {
    let list = [...demoRegLogs];
    if (params.result) list = list.filter((r) => r.result === params.result);
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '50', 10);
    return {
      data: list,
      pagination: { page, limit, total: list.length, totalPages: 1 },
    };
  }

  if (method === 'POST' && url === 'registrations') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const row = {
      id: `reg-${Date.now()}`,
      ...body,
      operator: DEMO_PROFILE.full_name,
      created_at: new Date().toISOString(),
    };
    demoRegLogs = [row, ...demoRegLogs];
    return row;
  }

  if (method === 'GET' && url === 'registrations/stats') {
    const siteKey = params.site || params.site_key;
    let rows = [...demoRegLogs];
    if (siteKey && siteKey !== 'all') rows = rows.filter((r) => r.site_key === siteKey);
    const total = rows.length;
    const success = rows.filter((r) => r.result === 'ok').length;
    const failed = rows.filter((r) => r.result === 'fail').length;
    const byReason = {};
    rows.filter((r) => r.result === 'fail').forEach((r) => {
      const reason = r.fail_reason || 'Other';
      byReason[reason] = (byReason[reason] || 0) + 1;
    });
    return {
      total,
      success,
      failed,
      successRate: total > 0 ? Math.round((success / total) * 1000) / 10 : 0,
      failReasons: Object.entries(byReason).map(([reason, count]) => ({ reason, count })),
    };
  }

  if (method === 'GET' && url === 'recovery/stats') {
    const siteKey = params.site || params.site_key;
    const attempts = [];
    demoAccounts.forEach((a) => {
      const rec = parseRecoveryMeta({ notes: a.notes });
      if (!rec?.log?.length) return;
      const meta = parseOperatorMeta(a);
      if (siteKey && siteKey !== 'all' && meta.site_key !== siteKey) return;
      const last = rec.log[rec.log.length - 1];
      if (last.st === 'ok' || last.st === 'fail') {
        attempts.push({ result: last.st, reason: last.reason || '' });
      }
    });
    const success = attempts.filter((a) => a.result === 'ok').length;
    const failed = attempts.filter((a) => a.result === 'fail').length;
    const total = attempts.length;
    const byReason = {};
    attempts.filter((a) => a.result === 'fail').forEach((a) => {
      byReason[a.reason || 'Other'] = (byReason[a.reason || 'Other'] || 0) + 1;
    });
    const failReasons = Object.entries(byReason).map(([label, count]) => ({
      label,
      count,
      pct: failed > 0 ? Math.round((count / failed) * 100) : 0,
    }));
    return {
      total,
      success,
      failed,
      pending: 0,
      successRate: total > 0 ? Math.round((success / total) * 1000) / 10 : 0,
      failReasons,
      detail: `${total} attempts · ${success} success · ${failed} failed`,
    };
  }

  if (method === 'GET' && url === 'health') {
    return { ok: true, demo: true };
  }

  if (method === 'GET' && url === 'ips') {
    syncDemoIpsFromSeed();
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '100', 10);
    return {
      data: demoIps,
      pagination: { page, limit, total: demoIps.length, totalPages: 1 },
    };
  }

  if (method === 'PATCH' && url.startsWith('ips/')) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    demoIps = demoIps.map((r) => (r.id === id ? { ...r, ...body } : r));
    return demoIps.find((r) => r.id === id);
  }

  if (method === 'DELETE' && url.startsWith('ips/')) {
    const id = url.split('/')[1];
    demoIps = demoIps.filter((r) => r.id !== id);
    return { ok: true };
  }

  if (method === 'GET' && url === 'sims') {
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '100', 10);
    return {
      data: demoSims.map((s) => ({
        ...s,
        phone_number: s.phone_number,
        carrier: s.carrier,
        location: s.location,
        expiry_date: null,
        status: s.last_charged ? 'OK' : 'EXPIRING',
        notes: s.location,
      })),
      pagination: { page, limit, total: demoSims.length, totalPages: 1 },
    };
  }

  if (method === 'GET' && url === 'tickets') {
    let rows = demoTickets.map(enrichDemoTicket);
    if (params.site && params.site !== 'all') {
      rows = rows.filter((r) => r.site_key === params.site);
    }
    return { data: rows };
  }

  if (method === 'GET' && url === 'tickets/stats') {
    let rows = demoTickets.map(enrichDemoTicket);
    if (params.site && params.site !== 'all') {
      rows = rows.filter((r) => r.site_key === params.site);
    }
    return ticketStatsFromRows(rows);
  }

  if (method === 'POST' && url === 'tickets') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const account = demoAccounts.find((a) => a.id === body.account_id);
    if (!account) throw new Error('Account not found');
    if (account.status !== 'AVAILABLE') throw new Error('Account must be in Standby (AVAILABLE) pool');
    if (!body.screenshot_base64 || !/^data:image\//i.test(body.screenshot_base64)) {
      throw new Error('Screenshot image required (JPEG, PNG, or WebP)');
    }

    const opMeta = parseOperatorMeta({ notes: account.notes });
    const ipRow = account.ip_id ? demoIps.find((i) => i.id === account.ip_id) : null;
    const reviewId = `igr-${Date.now()}`;
    demoIpGateReviews.push({
      id: reviewId,
      account_id: account.id,
      ticket_id: null,
      status: 'PENDING',
      submitted_by: DEMO_PROFILE.id,
      phone_ip_screenshot_url: body.screenshot_base64,
      created_at: new Date().toISOString(),
    });

    const meta = {
      site_key: opMeta.site_key || 'my',
      delivery_stage: 'submitted',
      link_code: body.link_code,
      shot_proxy: body.shot_proxy,
      bind_proxy_override: proxyFromIp(ipRow),
      channel: opMeta.channel || 'WS Normal',
      device_name: demoDevices.find((d) => d.id === account.device_id)?.device_name || '',
      account_display: account.account_name,
      phone_display: account.phone_number,
      ip_gate_review_id: reviewId,
      reject_reason: '',
    };

    const ticket = {
      id: `tk-new-${Date.now()}`,
      ticket_number: `T-${Math.floor(1000 + Math.random() * 9000)}`,
      title: `Delivery — ${account.account_name}`,
      description: serializeTicketDescription('', meta),
      status: 'OPEN',
      account_id: account.id,
      requester_id: DEMO_PROFILE.id,
      created_at: new Date().toISOString(),
      closed_at: null,
    };
    demoTickets.unshift(ticket);
    const review = demoIpGateReviews.find((r) => r.id === reviewId);
    if (review) review.ticket_id = ticket.id;
    return enrichDemoTicket(ticket);
  }

  if (method === 'POST' && /^tickets\/[^/]+\/go-live$/.test(url)) {
    const id = url.split('/')[1];
    const ticket = demoTickets.find((t) => t.id === id);
    if (!ticket) throw new Error('Ticket not found');
    const row = enrichDemoTicket(ticket);
    if (row.delivery_stage !== 'submitted') throw new Error('Ticket is not awaiting review');
    if (!row.ip_match) throw new Error('IP mismatch — reject instead of go-live');

    const meta = parseTicketMeta(ticket);
    meta.delivery_stage = 'posted';
    meta.reject_reason = '';
    if (meta.ip_gate_review_id) {
      demoIpGateReviews = demoIpGateReviews.map((r) => (
        r.id === meta.ip_gate_review_id
          ? { ...r, status: 'APPROVED', reviewed_at: new Date().toISOString() }
          : r
      ));
    }
    if (ticket.account_id) {
      demoAccounts = demoAccounts.map((a) => (
        a.id === ticket.account_id ? { ...a, status: 'IN_USE' } : a
      ));
    }
    ticket.status = 'IN_PROGRESS';
    ticket.description = serializeTicketDescription('', meta);
    return enrichDemoTicket(ticket);
  }

  if (method === 'POST' && /^tickets\/[^/]+\/reject$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data || {});
    const ticket = demoTickets.find((t) => t.id === id);
    if (!ticket) throw new Error('Ticket not found');
    const meta = parseTicketMeta(ticket);
    meta.reject_reason = body.reason || 'IP mismatch — resubmit with correct proxy screenshot';
    meta.delivery_stage = 'rejected';
    if (meta.ip_gate_review_id) {
      demoIpGateReviews = demoIpGateReviews.map((r) => (
        r.id === meta.ip_gate_review_id
          ? { ...r, status: 'REJECTED', reviewed_at: new Date().toISOString() }
          : r
      ));
    }
    ticket.description = serializeTicketDescription('', meta);
    return enrichDemoTicket(ticket);
  }

  if (method === 'POST' && /^tickets\/[^/]+\/resubmit$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const ticket = demoTickets.find((t) => t.id === id);
    if (!ticket) throw new Error('Ticket not found');
    if (!body.screenshot_base64 || !/^data:image\//i.test(body.screenshot_base64)) {
      throw new Error('Screenshot image required (JPEG, PNG, or WebP)');
    }
    const reviewId = `igr-${Date.now()}`;
    demoIpGateReviews.push({
      id: reviewId,
      account_id: ticket.account_id,
      ticket_id: ticket.id,
      status: 'PENDING',
      submitted_by: DEMO_PROFILE.id,
      phone_ip_screenshot_url: body.screenshot_base64,
      created_at: new Date().toISOString(),
    });
    const meta = parseTicketMeta(ticket);
    meta.delivery_stage = 'submitted';
    meta.link_code = body.link_code;
    meta.shot_proxy = body.shot_proxy;
    meta.reject_reason = '';
    meta.ip_gate_review_id = reviewId;
    ticket.status = 'OPEN';
    ticket.description = serializeTicketDescription('', meta);
    return enrichDemoTicket(ticket);
  }

  if (method === 'POST' && /^tickets\/[^/]+\/confirm$/.test(url)) {
    const id = url.split('/')[1];
    const ticket = demoTickets.find((t) => t.id === id);
    if (!ticket) throw new Error('Ticket not found');
    const row = enrichDemoTicket(ticket);
    if (row.delivery_stage !== 'posted') throw new Error('Ticket is not awaiting business confirmation');
    const meta = parseTicketMeta(ticket);
    meta.delivery_stage = 'done';
    ticket.status = 'RESOLVED';
    ticket.closed_at = new Date().toISOString();
    ticket.description = serializeTicketDescription('', meta);
    return enrichDemoTicket(ticket);
  }

  if (method === 'GET' && url === 'ip-gate') {
    const rows = demoIpGateReviews
      .filter((r) => r.status === 'PENDING')
      .map((rev) => {
        const ticket = demoTickets.find((t) => t.id === rev.ticket_id)
          || demoTickets.find((t) => parseTicketMeta(t).ip_gate_review_id === rev.id);
        const enriched = ticket ? enrichDemoTicket(ticket) : null;
        if (!enriched) return null;
        if (params.site && params.site !== 'all' && enriched.site_key !== params.site) return null;
        return {
          ...rev,
          ticket_id: ticket?.id,
          ticket_number: ticket?.ticket_number,
          site_key: enriched.site_key,
          account_name: enriched.account_name,
          phone_number: enriched.phone_number,
          device_name: enriched.device_name,
          channel: enriched.channel,
          link_code: enriched.link_code,
          bind_proxy: enriched.bind_proxy,
          shot_proxy: enriched.shot_proxy,
          ip_match: enriched.ip_match,
        };
      })
      .filter(Boolean);
    return { data: rows };
  }

  if (method === 'PATCH' && url.startsWith('sims/')) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    demoSims = demoSims.map((r) => (r.id === id ? { ...r, ...body } : r));
    return demoSims.find((r) => r.id === id);
  }

  if (method === 'GET' && url === 'devices') {
    syncDemoDevicesFromSeed();
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '100', 10);
    return {
      data: demoDevices,
      pagination: { page, limit, total: demoDevices.length, totalPages: 1 },
    };
  }

  if (method === 'GET' && url === 'audit') {
    let list = [...AUDIT_LOG];
    if (params.entity_type) list = list.filter((r) => r.entity_type === params.entity_type);
    if (params.action) list = list.filter((r) => r.action === params.action);
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '50', 10);
    return {
      data: list,
      pagination: { page, limit, total: list.length, totalPages: 1 },
    };
  }

  return { ok: true, demo: true, message: 'Mock endpoint' };
}

export function resetDemoData() {
  demoAccounts = buildSeedAccounts();
  demoIps = IPS_LEDGER.map((r) => ({ ...r }));
  demoSims = SIMS_LEDGER.map((r) => ({ ...r }));
  demoDevices = DEVICES_LIST.map((r) => ({ ...r }));
  demoTickets = buildSeedTickets();
  demoIpGateReviews = buildSeedIpGateReviews(demoTickets);
  demoRegLogs = DEMO_REG_LOGS.map((r) => ({ ...r }));
  seedStatusHistory();
  recomputeIpInUse();
}
