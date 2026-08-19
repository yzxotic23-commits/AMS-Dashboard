/** Demo mode — preview UI without real Supabase/API */
import {
  IPS_LEDGER, SIMS_LEDGER, AUDIT_LOG, DEVICES_LIST, FEEDING_AUDIT_LOG,
  DEMO_ACCOUNT_SEED, DEMO_REG_LOGS, TICKETS_SEED,
} from './wireframe-data';
import { serializeAccountNotes, parseOperatorMeta } from './account-operator-meta';
import { openAnomalyEvent, closeAnomalyEvent, finalizeAnomaly, aggregateAnomalyKpis } from './anomaly-event';
import { buildBanRecords, aggregateBanStats } from './ban-analytics';
import { serializeRecoveryNotes, recoveryOnBanDefaults, parseRecoveryMeta } from './account-recovery-meta';
import {
  parseTicketMeta, serializeTicketDescription, proxyFromIp, proxyMatch, stageFromStatus,
} from './ticket-meta';
import { ticketRejectReasonText } from './ticket-delivery';

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
  LOGGED_OUT: ['NURTURING', 'RECOVERING', 'RECYCLED', 'BANNED', 'IN_USE', 'AVAILABLE'],
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

  demoAccounts.forEach((a) => {
    const hist = demoStatusHistory[a.id];
    if (!hist) return;
    if (!['NURTURING', 'AVAILABLE', 'IN_USE'].includes(a.status)) return;
    const meta = parseOperatorMeta(a);
    const start = new Date(meta.nurturing_started_at || a.registration_date || a.created_at || Date.now()).getTime();
    hist.unshift({
      id: `sh-${a.id}-act`,
      account_id: a.id,
      from_status: 'REGISTERING',
      to_status: 'NURTURING',
      reason: 'Started Manual nurturing',
      changed_at: new Date(start).toISOString(),
      profiles: { full_name: DEMO_PROFILE.full_name },
    });
    const reachedSystem = meta.nurturing_phase === 'auto' || a.status !== 'NURTURING';
    if (reachedSystem) {
      hist.unshift({
        id: `sh-${a.id}-scan`,
        account_id: a.id,
        from_status: 'NURTURING',
        to_status: 'NURTURING',
        reason: 'Scan-in — Manual nurturing 3 days → System nurturing',
        changed_at: new Date(start + 2 * MS_DAY).toISOString(),
        profiles: { full_name: DEMO_PROFILE.full_name },
      });
    }
    if (a.status === 'AVAILABLE' || a.status === 'IN_USE') {
      const total = Math.max(7, Math.floor((Date.now() - start) / MS_DAY) + 1);
      const autoDays = Math.max(1, total - 3);
      const standbyAt = start + (total - 1) * MS_DAY;
      hist.unshift({
        id: `sh-${a.id}-stdby`,
        account_id: a.id,
        from_status: 'NURTURING',
        to_status: 'AVAILABLE',
        reason: `Nurturing complete — Manual nurturing 3 days, System nurturing ${autoDays} days → Standby`,
        changed_at: new Date(standbyAt).toISOString(),
        profiles: { full_name: DEMO_PROFILE.full_name },
      });
      if (a.status === 'IN_USE') {
        hist.unshift({
          id: `sh-${a.id}-inuse`,
          account_id: a.id,
          from_status: 'AVAILABLE',
          to_status: 'IN_USE',
          reason: 'Go-live ticket — Standby 2 days → In Use (business scan)',
          changed_at: new Date(standbyAt + 2 * MS_DAY).toISOString(),
          profiles: { full_name: DEMO_PROFILE.full_name },
        });
      }
    }
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
  const now = Date.now();
  // Varied ages so Waiting / Process labels are easy to demo.
  const timingById = {
    'T-3391': { submittedAgoMs: 25 * 60_000 }, // Waiting ~25m — fresh pending (alert)
    'T-3389': { submittedAgoMs: 2 * 3600_000 }, // Waiting ~2h
    'T-3388': { submittedAgoMs: 6 * 3600_000 }, // Waiting ~6h — overdue pending
    'T-3390': { submittedAgoMs: 45 * 60_000 },
    'T-3387': { submittedAgoMs: 3 * 3600_000 },
    'T-3386': { submittedAgoMs: 3 * 3600_000, progressAfterMs: 40 * 60_000 }, // Process ~40m
    'T-3385': { submittedAgoMs: 5 * 3600_000, progressAfterMs: 90 * 60_000 },
    'T-3384': { submittedAgoMs: 4 * 3600_000, progressAfterMs: 55 * 60_000 },
    'T-3380': { submittedAgoMs: 26 * 3600_000, progressAfterMs: 20 * 60_000, closedAfterMs: 2 * 3600_000 },
    'T-3378': { submittedAgoMs: 30 * 3600_000, progressAfterMs: 15 * 60_000, closedAfterMs: 90 * 60_000 },
    'T-3382': { submittedAgoMs: 20 * 3600_000, progressAfterMs: 35 * 60_000, closedAfterMs: 3 * 3600_000 },
    'T-3381': { submittedAgoMs: 18 * 3600_000, progressAfterMs: 50 * 60_000, closedAfterMs: 2.5 * 3600_000 },
  };

  return all.map((w, i) => {
    const bind = wireProxy(w.bind);
    const shot = wireProxy(w.shot);
    const t = timingById[w.id] || { submittedAgoMs: (all.length - i) * 3600_000 };
    const submittedAt = new Date(now - t.submittedAgoMs).toISOString();
    const inProgressAt = t.progressAfterMs != null
      ? new Date(now - t.submittedAgoMs + t.progressAfterMs).toISOString()
      : undefined;
    const closedAt = t.closedAfterMs != null
      ? new Date(now - t.submittedAgoMs + t.closedAfterMs).toISOString()
      : (w.state === 'done' ? new Date().toISOString() : null);

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
      submitted_at: submittedAt,
      ...(inProgressAt ? { in_progress_at: inProgressAt } : {}),
      ...(closedAt && w.state !== 'submitted' ? { closed_at: closedAt } : {}),
    };
    return {
      id: `tk-${w.id.toLowerCase()}`,
      ticket_number: w.id,
      title: `Delivery — ${w.acct}`,
      description: serializeTicketDescription('', meta),
      status: ticketStatusFromStage(w.state),
      account_id: null,
      requester_id: DEMO_PROFILE.id,
      created_at: submittedAt,
      closed_at: w.state === 'done' || w.state === 'rejected' ? (closedAt || new Date().toISOString()) : null,
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
    review_match: meta.review_match ?? null,
    ip_match: meta.review_match ?? proxyMatch(bind, shot),
    reject_reason: ticketRejectReasonText({
      ...meta,
      review_note: review?.review_note,
    }),
    channel: meta.channel || '—',
    device_name: meta.device_name || account?.devices?.device_name || '—',
    account_name: meta.account_display || account?.account_name || '—',
    phone_number: meta.phone_display || account?.phone_number || '—',
    ip_gate_review_id: meta.ip_gate_review_id || null,
    screenshot_url,
    submitted_at: meta.submitted_at || ticket.created_at || null,
    in_progress_at: meta.in_progress_at || null,
    closed_at: meta.closed_at || ticket.closed_at || null,
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
    const success = entries.filter((e) => e.feedingStatus === 'Success').length;
    const restrict = entries.filter((e) => e.feedingStatus === 'Restrict').length;
    const banned = entries.filter((e) => e.feedingStatus === 'Banned').length;
    const total = success + restrict + banned;
    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    return {
      ok: true,
      total: entries.length,
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
      deliveryTickets: demoTickets
        .filter((t) => t.account_id === id)
        .map((t) => {
          const meta = parseTicketMeta(t);
          return {
            id: t.id,
            ticket_number: t.ticket_number,
            status: t.status,
            created_at: t.created_at,
            submitted_at: meta.submitted_at || t.created_at,
            in_progress_at: meta.in_progress_at || null,
            delivery_stage: meta.delivery_stage,
          };
        }),
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
      const next = {
        ...a,
        ...body,
        notes: body.notes ?? a.notes,
        updated_at: new Date().toISOString(),
      };
      if (body.ip_id == null) next.ip_id = a.ip_id;
      return next;
    });
    const row = demoAccounts.find((a) => a.id === id);
    if (body.ip_id) syncIpAssignment(prev.ip_id, body.ip_id);
    if (body.device_id !== undefined) syncDeviceBinding(prev.device_id, body.device_id, id);
    if (body.status && body.status !== prev.status) {
      pushStatusHistory(id, prev.status, body.status, body.reason || 'Status updated');
    } else {
      const prevMeta = parseOperatorMeta(prev);
      const nextMeta = parseOperatorMeta(row);
      if (prevMeta.nurturing_phase === 'manual' && nextMeta.nurturing_phase === 'auto') {
        pushStatusHistory(id, 'NURTURING', 'NURTURING', 'Scan-in — Manual nurturing 3 days → System nurturing');
      } else if (prevMeta.nurturing_phase === 'auto' && nextMeta.nurturing_phase === 'manual') {
        pushStatusHistory(id, 'NURTURING', 'NURTURING', 'Returned to Manual nurturing (from System nurturing)');
      }
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
    let histReason = body.reason || 'State transition';
    if (current.status === 'REGISTERING' && body.to_status === 'NURTURING') {
      histReason = 'Started Manual nurturing';
    } else if (current.status === 'NURTURING' && body.to_status === 'AVAILABLE') {
      histReason = `${body.reason || 'Nurturing complete'} · Manual nurturing 3 days, System nurturing → Standby`;
    }
    demoAccounts = demoAccounts.map((a) => (
      a.id === id
        ? { ...a, status: body.to_status, updated_at: new Date().toISOString() }
        : a
    ));
    pushStatusHistory(id, current.status, body.to_status, histReason);
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'POST' && /^accounts\/[^/]+\/engine-disconnect$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data || {});
    const current = demoAccounts.find((a) => a.id === id);
    if (!current) throw new Error('Account not found');
    if (current.status !== 'IN_USE' && current.status !== 'NURTURING') {
      return { ...enrichAccount(current), _skipped: true, reason: 'not_keep_alive' };
    }
    const meta = parseOperatorMeta(current);
    const reportNote = (body.note || '').trim()
      || 'Auto-detected by AMS: FeedFlow slot offline / logged out';
    const opened = openAnomalyEvent(meta, {
      fromStatus: current.status,
      reportedBy: 'AMS Engine',
      note: reportNote,
      source: 'engine_health',
      slot: body.slot == null ? null : Number(body.slot),
    });
    const notes = serializeAccountNotes({ ...meta, ...opened });
    const nextStatus = current.status === 'IN_USE' ? 'LOGGED_OUT' : current.status;
    demoAccounts = demoAccounts.map((a) => (
      a.id === id
        ? { ...a, status: nextStatus, notes, updated_at: new Date().toISOString() }
        : a
    ));
    if (nextStatus !== current.status) {
      pushStatusHistory(id, current.status, nextStatus, `[pending] ${reportNote}`);
    }
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'POST' && /^accounts\/[^/]+\/report-disconnect$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data || {});
    const current = demoAccounts.find((a) => a.id === id);
    if (!current) throw new Error('Account not found');
    if (current.status !== 'IN_USE') throw new Error('Only accounts currently In Use can be reported as disconnected');
    const meta = parseOperatorMeta(current);
    if (meta.disconnect_report) {
      return { ...enrichAccount(current), _alreadyReported: true };
    }
    const opened = openAnomalyEvent(meta, {
      fromStatus: current.status,
      reportedBy: DEMO_PROFILE.full_name,
      note: (body.note || '').trim(),
      source: 'business',
    });
    const notes = serializeAccountNotes({ ...meta, ...opened });
    demoAccounts = demoAccounts.map((a) => (
      a.id === id ? { ...a, notes, updated_at: new Date().toISOString() } : a
    ));
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'POST' && /^accounts\/[^/]+\/resolve-disconnect$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data || {});
    const current = demoAccounts.find((a) => a.id === id);
    if (!current) throw new Error('Account not found');
    const meta = parseOperatorMeta(current);
    if (!meta.disconnect_report) throw new Error('No pending disconnect report for this account');
    const outcome = body.outcome;
    const closed = closeAnomalyEvent(meta, {
      outcome,
      reason: body.reason || outcome,
      restrictKind: (outcome === 'restrict_scan' || outcome === 'restrict_chat_new') ? outcome : null,
    });
    if (outcome === 'false_positive') {
      const fromStatus = meta.disconnect_report.from_status || current.status;
      const nextStatus = fromStatus === 'NURTURING' || fromStatus === 'IN_USE' ? fromStatus : current.status;
      const notes = serializeAccountNotes({ ...meta, ...closed, business_notice: undefined });
      demoAccounts = demoAccounts.map((a) => (
        a.id === id ? { ...a, status: nextStatus, notes, updated_at: new Date().toISOString() } : a
      ));
      pushStatusHistory(id, current.status, nextStatus, `[false_positive] ${body.reason || outcome}`);
      return enrichAccount(demoAccounts.find((a) => a.id === id));
    }
    if (outcome === 'logged_out' || outcome === 'banned') {
      const toStatus = outcome === 'logged_out' ? 'LOGGED_OUT' : 'BANNED';
      if (current.status !== toStatus) {
        const allowed = ALLOWED_TRANSITIONS[current.status] || [];
        if (!allowed.includes(toStatus)) {
          throw new Error(`Invalid state transition: ${current.status} → ${toStatus}`);
        }
      }
      const nextMeta = {
        ...meta,
        ...closed,
        disconnect_report: undefined,
      };
      delete nextMeta.disconnect_report;
      delete nextMeta.business_notice;
      let notes = serializeAccountNotes(nextMeta);
      if (toStatus === 'BANNED') {
        notes = serializeRecoveryNotes(notes, recoveryOnBanDefaults('manual', body.reason || 'Banned'));
        bumpDemoIpRisk(current.ip_id);
      }
      demoAccounts = demoAccounts.map((a) => (
        a.id === id
          ? { ...a, status: toStatus, notes, updated_at: new Date().toISOString() }
          : a
      ));
      pushStatusHistory(id, current.status, toStatus, body.reason || outcome);
      return enrichAccount(demoAccounts.find((a) => a.id === id));
    }
    const restrictLabel = outcome === 'restrict_scan'
      ? 'Restricted Scan'
      : 'Restricted Chat New Contact';
    const nextMeta = {
      ...meta,
      ...closed,
      restrict_kind: outcome,
      ...(outcome === 'restrict_scan'
        ? {
            nurturing_phase: 'manual',
            nurturing_started_at: new Date(Date.now() - 2 * MS_DAY).toISOString(),
          }
        : {}),
    };
    delete nextMeta.disconnect_report;
    delete nextMeta.business_notice;
    const notes = serializeAccountNotes(nextMeta);
    demoAccounts = demoAccounts.map((a) => (
      a.id === id ? { ...a, notes, updated_at: new Date().toISOString() } : a
    ));
    pushStatusHistory(id, current.status, current.status, `${restrictLabel} · ${body.reason || outcome}`);
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'POST' && /^accounts\/[^/]+\/return-standby$/.test(url)) {
    const id = url.split('/')[1];
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data || {});
    const current = demoAccounts.find((a) => a.id === id);
    if (!current) throw new Error('Account not found');
    const meta = parseOperatorMeta(current);
    if (current.status !== 'IN_USE' || !meta.restrict_kind) {
      throw new Error('Only In Use accounts that are Restricted can return to Standby');
    }
    const allowed = ALLOWED_TRANSITIONS[current.status] || [];
    if (!allowed.includes('AVAILABLE')) {
      throw new Error(`Invalid state transition: ${current.status} → AVAILABLE`);
    }
    const restrictLabel = meta.restrict_kind === 'restrict_scan'
      ? 'Restricted Scan'
      : 'Restricted Chat New Contact';
    const note = (body.reason || '').trim()
      || `${restrictLabel} period ended — returned to Standby for re-delivery`;
    const nextMeta = {
      ...meta,
      restrict_kind: undefined,
      disconnect_report: undefined,
      business_notice: {
        type: 'returned_standby',
        at: new Date().toISOString(),
        title: `${current.account_name || 'Account'} is ready to scan again`,
        body: `Restriction ended. ${current.account_name} is back on Standby — open Delivery tickets to request a new scan.`,
      },
    };
    delete nextMeta.restrict_kind;
    delete nextMeta.disconnect_report;
    const notes = serializeAccountNotes(nextMeta, note);
    demoAccounts = demoAccounts.map((a) => (
      a.id === id
        ? { ...a, status: 'AVAILABLE', notes, wsaf_slot: null, updated_at: new Date().toISOString() }
        : a
    ));
    pushStatusHistory(id, current.status, 'AVAILABLE', note);
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'POST' && /^accounts\/[^/]+\/ack-notice$/.test(url)) {
    const id = url.split('/')[1];
    const current = demoAccounts.find((a) => a.id === id);
    if (!current) throw new Error('Account not found');
    const meta = parseOperatorMeta(current);
    const nextMeta = { ...meta };
    delete nextMeta.business_notice;
    const notes = serializeAccountNotes(nextMeta);
    demoAccounts = demoAccounts.map((a) => (
      a.id === id ? { ...a, notes, updated_at: new Date().toISOString() } : a
    ));
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
    const meta = parseOperatorMeta(current);
    const closed = finalizeAnomaly(meta, {
      outcome: 'banned',
      reason: banReason,
      fromStatus: current.status,
      source: body.source || 'ban_form',
    });
    let notes = serializeAccountNotes({ ...meta, ...closed, business_notice: undefined });
    notes = serializeRecoveryNotes(notes, recoveryOnBanDefaults(body.stage, body.reason));
    demoAccounts = demoAccounts.map((a) => (
      a.id === id ? { ...a, status: 'BANNED', notes, updated_at: new Date().toISOString() } : a
    ));
    pushStatusHistory(id, current.status, 'BANNED', banReason);
    bumpDemoIpRisk(current.ip_id);
    return enrichAccount(demoAccounts.find((a) => a.id === id));
  }

  if (method === 'GET' && url === 'bans/stats') {
    const siteKey = params.site || params.site_key || 'all';
    const records = demoBanRecords();
    const stats = aggregateBanStats(records, { siteKey });
    const pool = demoAccounts.filter((a) => a.status !== 'RECYCLED');
    const range = (params.from && params.to)
      ? { from: params.from, to: params.to }
      : null;
    const inDateRange = (iso, r) => {
      if (!iso || !r) return true;
      const t = new Date(iso).getTime();
      return t >= new Date(r.from).getTime() && t <= new Date(r.to).getTime();
    };
    const anomalyKpis = aggregateAnomalyKpis(
      pool.map((a) => ({ ...a, _meta: parseOperatorMeta(a) })),
      { range, siteKey, inDateRange },
    );
    const poolSize = pool.length;
    const overallPct = poolSize > 0
      ? Math.round((anomalyKpis.bannedTotal / poolSize) * 1000) / 10
      : 0;
    const flaggedIps = demoIps
      .filter((ip) => (ip.risk_count || 0) >= stats.badIpThreshold || ip.status === 'FLAGGED')
      .slice(0, 10);
    return {
      ...stats,
      byStage: anomalyKpis.byStage.length ? anomalyKpis.byStage : stats.byStage,
      total: anomalyKpis.bannedTotal,
      overallPct,
      poolSize,
      flaggedIps,
      pendingBacklog: anomalyKpis.pendingBacklog,
      restrictTotal: anomalyKpis.restrictTotal,
      logoutTotal: anomalyKpis.logoutTotal,
      falsePositiveTotal: anomalyKpis.falsePositiveTotal,
    };
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
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (Math.max(1, page) - 1) * limit;
    return {
      data: list.slice(offset, offset + limit),
      pagination: { page, limit, total, totalPages },
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
    let list = [...demoIps];
    if (params.status) list = list.filter((r) => r.status === params.status || (params.status === 'ACTIVE' && r.active));
    if (params.search) {
      const q = String(params.search).toLowerCase();
      list = list.filter((r) =>
        String(r.ip_address || '').toLowerCase().includes(q)
        || String(r.proxy_provider || '').toLowerCase().includes(q)
        || String(r.country || '').toLowerCase().includes(q));
    }
    const page = parseInt(params.page || '1', 10);
    const limit = parseInt(params.limit || '100', 10);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (Math.max(1, page) - 1) * limit;
    return {
      data: list.slice(offset, offset + limit),
      pagination: { page, limit, total, totalPages },
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

  if (method === 'GET' && url === 'tickets/standby-accounts') {
    const siteKey = params.site || params.site_key;
    const rows = demoAccounts
      .filter((a) => {
        if (a.status !== 'AVAILABLE' && a.status !== 'LOGGED_OUT') return false;
        const meta = parseOperatorMeta(a);
        if (meta.restrict_kind) return false;
        if (siteKey && siteKey !== 'all' && meta.site_key !== siteKey) return false;
        return true;
      })
      .map((a) => {
        const meta = parseOperatorMeta(a);
        const enriched = enrichAccount(a);
        const ip = enriched.ips;
        return {
          id: a.id,
          account_name: a.account_name,
          phone_number: a.phone_number || '',
          sim: enriched.sims
            ? `${enriched.sims.carrier || 'SIM'} · ${enriched.sims.phone_number}`
            : '',
          brand: meta.brand || '',
          siteKey: meta.site_key || 'my',
          owner: meta.owner || '',
          staff: String(meta.staff || '').trim(),
          bind_proxy: ip ? {
            ip_address: ip.ip_address || '',
            port: String(ip.port || '8080'),
            username: ip.username || '',
            password: ip.password || '',
          } : null,
          status: a.status,
        };
      });
    return { data: rows };
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
    if (account.status !== 'AVAILABLE' && account.status !== 'LOGGED_OUT') {
      throw new Error('Account must be Standby or Logged out to request a scan');
    }
    const opMetaCheck = parseOperatorMeta({ notes: account.notes });
    if (opMetaCheck.restrict_kind) {
      throw new Error('Restricted accounts must return to Standby before a new scan request');
    }
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
    pushStatusHistory(
      account.id,
      account.status,
      account.status,
      account.status === 'LOGGED_OUT'
        ? `Delivery ticket #${ticket.ticket_number} submitted — re-scan after logout (awaiting IP review)`
        : `Delivery ticket #${ticket.ticket_number} submitted — awaiting IP review (business scan)`,
    );
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
    meta.in_progress_at = new Date().toISOString();
    if (meta.ip_gate_review_id) {
      demoIpGateReviews = demoIpGateReviews.map((r) => (
        r.id === meta.ip_gate_review_id
          ? { ...r, status: 'APPROVED', reviewed_at: new Date().toISOString() }
          : r
      ));
    }
    if (ticket.account_id) {
      const prev = demoAccounts.find((a) => a.id === ticket.account_id);
      const fromStatus = prev?.status || 'AVAILABLE';
      demoAccounts = demoAccounts.map((a) => {
        if (a.id !== ticket.account_id) return a;
        const meta = parseOperatorMeta(a);
        const nextMeta = { ...meta };
        delete nextMeta.disconnect_report;
        return {
          ...a,
          status: 'IN_USE',
          notes: serializeAccountNotes(nextMeta),
          wsaf_slot: fromStatus === 'LOGGED_OUT' ? null : a.wsaf_slot,
          updated_at: new Date().toISOString(),
        };
      });
      pushStatusHistory(
        ticket.account_id,
        fromStatus,
        'IN_USE',
        fromStatus === 'LOGGED_OUT'
          ? `Go-live ticket #${ticket.ticket_number} — Logged out → In Use (re-scan)`
          : `Go-live ticket #${ticket.ticket_number} — Standby → In Use (business scan)`,
      );
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
    meta.reject_reason = ticketRejectReasonText({
      ...meta,
      delivery_stage: 'rejected',
      reject_reason: body.reason || '',
    });
    meta.delivery_stage = 'rejected';
    meta.closed_at = new Date().toISOString();
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
    meta.submitted_at = new Date().toISOString();
    meta.in_progress_at = undefined;
    meta.closed_at = undefined;
    meta.link_code = body.link_code;
    meta.shot_proxy = body.shot_proxy;
    meta.reject_reason = '';
    meta.ip_gate_review_id = reviewId;
    ticket.status = 'OPEN';
    ticket.closed_at = null;
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
    meta.closed_at = new Date().toISOString();
    ticket.status = 'RESOLVED';
    ticket.closed_at = meta.closed_at;
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
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (Math.max(1, page) - 1) * limit;
    return {
      data: list.slice(offset, offset + limit),
      pagination: { page, limit, total, totalPages },
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
