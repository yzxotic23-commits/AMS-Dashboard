/** Wireframe demo data — mirrors AMS Development Draft.html */

import { ACCOUNT_STATUS, RECOVERY_STATUS } from './operator-copy';

export const HUB_STAFF = [
  { code: 'RM-1', name: 'RM Executor 1', site: 'my', reg: 3, rec: 1, man: 2, scan: 1, tk: 1 },
  { code: 'RM-2', name: 'RM Executor 2', site: 'my', reg: 2, rec: 0, man: 1, scan: 0, tk: 2 },
  { code: 'RM-3', name: 'RM Executor 3', site: 'my', reg: 0, rec: 0, man: 0, scan: 0, tk: 0 },
  { code: 'PP-1', name: 'PP Executor 1', site: 'pp', reg: 1, rec: 2, man: 1, scan: 1, tk: 0 },
  { code: 'PP-2', name: 'PP Executor 2', site: 'pp', reg: 0, rec: 0, man: 1, scan: 0, tk: 1 },
];

export const HUB_COLS = [
  { key: 'reg', label: 'To Register', route: '/register', tone: 'reg' },
  { key: 'link', label: 'To Link', route: '/link', tone: 'link' },
  { key: 'man', label: 'Device Farm', route: '/link?tab=nurturing', tone: 'man' },
  { key: 'scan', label: 'To Scan In', route: '/link?tab=nurturing', tone: 'scan' },
  { key: 'rec', label: 'To Recover', route: '/recovery', tone: 'rec' },
  { key: 'tk', label: 'Tickets', route: '/tickets', tone: 'htk' },
];

export const HUB_TASK_TONE = {
  reg: 'text-ams-blue',
  link: 'text-ams-accent',
  rec: 'text-ams-danger',
  man: 'text-ams-warn',
  scan: 'text-ams-blue',
  htk: 'text-ams-success',
};

export const RL_STATUS = {
  nurturing: { label: ACCOUNT_STATUS.nurturing, pill: 'badge-warn' },
  standby: { label: ACCOUNT_STATUS.standby, pill: 'badge-success' },
  inuse: { label: ACCOUNT_STATUS.inuse, pill: 'badge-accent' },
  recovering: { label: ACCOUNT_STATUS.recovering, pill: 'badge-warn' },
  banned: { label: ACCOUNT_STATUS.banned, pill: 'badge-danger' },
  empty: { label: ACCOUNT_STATUS.empty, pill: 'badge-default' },
};

/** Resource Ledger devices — 12 devices (6 MY + 6 PP) */
export const RL_DEVICES = [
  {
    id: 'MYR-SB-001', site: 'my', shelf: 'Shelf A · Slot 1',
    normal: { acct: 'SBMY ela', ph: '+60 10-529 9493', st: 'inuse', brand: 'SBMY', owner: 'Alex', proxy: { addr: '103.21.44.12' } },
    business: { acct: 'SBMY Zara', ph: '+60 11-6176 1052', st: 'inuse', brand: 'SBMY', owner: 'Alex', proxy: { addr: '103.21.44.13' } },
  },
  {
    id: 'MYR-SB-002', site: 'my', shelf: 'Shelf A · Slot 2',
    normal: { acct: 'SBMY mey', ph: '+60 10-806 6584', st: 'standby', brand: 'SBMY', owner: 'Bryan', proxy: { addr: '103.21.44.15' } },
    business: { acct: 'SBMY andy', ph: '+60 10-794 2539', st: 'nurturing', brand: 'SBMY', owner: 'Bryan', proxy: { addr: '103.21.44.16' }, day: 5 },
  },
  {
    id: 'MYR-SB-003', site: 'my', shelf: 'Shelf A · Slot 3',
    normal: { acct: 'Janice', ph: '+60 10-815 2653', st: 'recovering', brand: 'JMMY', owner: 'Geri', proxy: { addr: '103.21.44.19' } },
    business: { acct: 'Susan', ph: '+60 11-7311 517', st: 'banned', brand: 'JMMY', owner: 'Geri', proxy: { addr: '103.21.44.19' } },
  },
  {
    id: 'MYR-SB-005', site: 'my', shelf: 'Shelf A · Slot 5',
    normal: { acct: 'SBMY ela2', ph: '+60 11-2204 5580', st: 'nurturing', brand: 'SBMY', owner: 'Alex', proxy: { addr: '103.21.44.20' }, day: 2 },
    business: { acct: 'SBMY ela3', ph: '+60 11-2204 5571', st: 'standby', brand: 'SBMY', owner: 'Alex', proxy: { addr: '103.21.44.21' } },
  },
  {
    id: 'MYR-SB-006', site: 'my', shelf: 'Shelf A · Slot 6',
    normal: { acct: 'Rita', ph: '+60 11-9001 2211', st: 'inuse', brand: 'JMMY', owner: 'Bryan', proxy: { addr: '103.21.44.28' } },
    business: { acct: 'Dora', ph: '+60 11-3340 1188', st: 'standby', brand: 'JMMY', owner: 'Geri', proxy: { addr: '103.21.44.30' } },
  },
  {
    id: 'MYR-SB-008', site: 'my', shelf: 'Shelf A · Slot 8',
    normal: { acct: 'Oliver2', ph: '+60 10-770 6093', st: 'nurturing', brand: 'SBMY', owner: 'Geri', proxy: { addr: '103.21.44.22' }, day: 6 },
    business: { acct: 'Pam', ph: '+60 11-8800 4412', st: 'nurturing', brand: 'SBMY', owner: 'Geri', proxy: { addr: '103.21.44.23' }, day: 4 },
  },
  {
    id: 'MYR-SB-009', site: 'my', shelf: 'Shelf A · Slot 9',
    normal: { acct: 'Cindy', ph: '+60 11-5500 3311', st: 'nurturing', brand: 'JMMY', owner: 'Alex', proxy: { addr: '103.21.44.25' }, day: 3 },
    business: { acct: 'Marcus', ph: '+60 11-5500 3312', st: 'nurturing', brand: 'JMMY', owner: 'Alex', proxy: { addr: '103.21.44.26' }, day: 1 },
  },
  {
    id: 'MYR-SB-011', site: 'my', shelf: 'Shelf A · Slot 11',
    normal: { acct: 'Leah', ph: '+60 11-6600 7722', st: 'nurturing', brand: 'SBMY', owner: 'Bryan', proxy: { addr: '103.21.44.27' }, day: 2 },
    business: { acct: 'Theo', ph: '+60 11-6600 7723', st: 'nurturing', brand: 'SBMY', owner: 'Bryan', proxy: { addr: '103.21.44.29' }, day: 3 },
  },
  {
    id: 'PP-SB-014', site: 'pp', shelf: 'Shelf B · Slot 2',
    normal: { acct: 'Lina', ph: '+855 96 968 7960', st: 'standby', brand: 'STMY', owner: 'Alex', proxy: { addr: '175.100.8.41' } },
    business: { acct: 'Tamara', ph: '+855 96 227 4789', st: 'inuse', brand: 'STMY', owner: 'Alex', proxy: { addr: '175.100.8.42' } },
  },
  {
    id: 'PP-SB-015', site: 'pp', shelf: 'Shelf B · Slot 5',
    normal: { acct: 'William', ph: '+855 96 972 5409', st: 'nurturing', brand: 'JMMY', owner: 'Bryan', proxy: { addr: '175.100.8.55' }, day: 2 },
    business: { acct: 'steven', ph: '+855 96 979 7581', st: 'nurturing', brand: 'JMMY', owner: 'Bryan', proxy: { addr: '175.100.8.56' }, day: 2 },
  },
  {
    id: 'PP-SB-016', site: 'pp', shelf: 'Shelf B · Slot 4',
    normal: { acct: 'Joyce', ph: '+855 96 331 2200', st: 'banned', brand: 'STMY', owner: 'Geri', proxy: { addr: '175.100.8.58' } },
    business: { acct: 'Mia', ph: '+855 96 331 2201', st: 'nurturing', brand: 'STMY', owner: 'Geri', proxy: { addr: '175.100.8.59' }, day: 1 },
  },
  {
    id: 'PP-SB-018', site: 'pp', shelf: 'Shelf B · Slot 6',
    normal: { acct: 'Ben', ph: '+855 96 441 3300', st: 'nurturing', brand: 'JMMY', owner: 'Alex', proxy: { addr: '175.100.8.61' }, day: 1 },
    business: { acct: 'Vera', ph: '+855 96 441 3301', st: 'nurturing', brand: 'JMMY', owner: 'Alex', proxy: { addr: '175.100.8.62' }, day: 4 },
  },
  {
    id: 'PP-SB-019', site: 'pp', shelf: 'Shelf B · Slot 3',
    normal: { acct: 'Nina', ph: '+855 96 552 4400', st: 'nurturing', brand: 'STMY', owner: 'Bryan', proxy: { addr: '175.100.8.63' }, day: 6 },
    business: { acct: 'Kai', ph: '+855 96 552 4401', st: 'nurturing', brand: 'STMY', owner: 'Bryan', proxy: { addr: '175.100.8.64' }, day: 5 },
  },
  {
    id: 'PP-SB-022', site: 'pp', shelf: 'Shelf B · Slot 7',
    normal: { acct: 'Sammy', ph: '+855 96 509 5192', st: 'recovering', brand: 'STMY', owner: 'Geri', proxy: { addr: '175.100.8.70' } },
    business: { acct: null, st: 'empty', brand: 'STMY', owner: 'Geri' },
  },
];

export const RL_OWNER_OPTIONS = [];

/** @deprecated No dummy owner inference — owner comes from account metadata. */
export function inferOwnerFromLedger() {
  return '';
}

/** @deprecated No dummy owner inference — owner comes from account metadata. */
export function inferOwnerFromDevice() {
  return '';
}

/** Business delivery tickets — 12 tickets across MY + PP */
export const TICKETS_SEED = {
  my: [
    { id: 'T-3391', site: 'my', acct: 'SBMY mey', phone: '+60 10-806 6584', bind: { addr: '103.21.44.15', port: '8080', user: 'res_my02', pw: 'Tz4!po8B' }, shot: { addr: '103.21.44.15', port: '8080', user: 'res_my02', pw: 'Tz4!po8B' }, code: '482190', dev: 'MYR-SB-002', ch: 'WS Normal', state: 'submitted' },
    { id: 'T-3389', site: 'my', acct: 'SBMY ela3', phone: '+60 11-2204 5571', bind: { addr: '103.21.44.21', port: '8080', user: 'res_my05', pw: 'Vk2@np7Q' }, shot: { addr: '103.21.44.99', port: '8080', user: 'res_my05', pw: 'Vk2@np7Q' }, code: '771203', dev: 'MYR-SB-005', ch: 'WS Normal', state: 'submitted' },
    { id: 'T-3388', site: 'my', acct: 'Dora', phone: '+60 11-3340 1188', bind: { addr: '103.21.44.30', port: '8080', user: 'res_my10', pw: 'Zx4$mk1R' }, shot: { addr: '103.21.44.30', port: '8080', user: 'res_my10', pw: 'Zx4$mk1R' }, code: '902114', dev: 'MYR-SB-006', ch: 'WS Business', state: 'submitted' },
    { id: 'T-3386', site: 'my', acct: 'Rita', phone: '+60 11-9001 2211', bind: { addr: '103.21.44.28', port: '8080', user: 'res_my08', pw: 'Hm9#qw2L' }, shot: { addr: '103.21.44.28', port: '8080', user: 'res_my08', pw: 'Hm9#qw2L' }, code: '330815', dev: 'MYR-SB-006', ch: 'WS Normal', state: 'posted' },
    { id: 'T-3385', site: 'my', acct: 'SBMY Zara', phone: '+60 11-6176 1052', bind: { addr: '103.21.44.13', port: '8080', user: 'res_my01b', pw: 'Px9$km2B' }, shot: { addr: '103.21.44.13', port: '8080', user: 'res_my01b', pw: 'Px9$km2B' }, code: '551902', dev: 'MYR-SB-001', ch: 'WS Business', state: 'posted' },
    { id: 'T-3380', site: 'my', acct: 'SBMY ela', phone: '+60 10-529 9493', bind: { addr: '103.21.44.12', port: '8080', user: 'res_my01', pw: 'Px9$km2A' }, shot: { addr: '103.21.44.12', port: '8080', user: 'res_my01', pw: 'Px9$km2A' }, code: '', dev: 'MYR-SB-001', ch: 'WS Normal', state: 'done' },
    { id: 'T-3378', site: 'my', acct: 'Janice', phone: '+60 10-815 2653', bind: { addr: '103.21.44.19', port: '8080', user: 'res_my03', pw: 'Qw7@nb1C' }, shot: { addr: '103.21.44.19', port: '8080', user: 'res_my03', pw: 'Qw7@nb1C' }, code: '', dev: 'MYR-SB-003', ch: 'WS Normal', state: 'done' },
  ],
  pp: [
    { id: 'T-3390', site: 'pp', acct: 'Lina', phone: '+855 96 968 7960', bind: { addr: '175.100.8.41', port: '3128', user: 'res_pp01', pw: 'Bn5%xz3E' }, shot: { addr: '175.100.8.41', port: '3128', user: 'res_pp01', pw: 'Bn5%xz3E' }, code: '905512', dev: 'PP-SB-014', ch: 'WS Normal', state: 'submitted' },
    { id: 'T-3387', site: 'pp', acct: 'Nina', phone: '+855 96 552 4400', bind: { addr: '175.100.8.63', port: '3128', user: 'res_pp06', pw: 'Lm3#rt9K' }, shot: { addr: '175.100.8.63', port: '3128', user: 'res_pp06', pw: 'Lm3#rt9K' }, code: '664821', dev: 'PP-SB-019', ch: 'WS Normal', state: 'submitted' },
    { id: 'T-3384', site: 'pp', acct: 'Tamara', phone: '+855 96 227 4789', bind: { addr: '175.100.8.42', port: '3128', user: 'res_pp02', pw: 'Hk8&qw0F' }, shot: { addr: '175.100.8.42', port: '3128', user: 'res_pp02', pw: 'Hk8&qw0F' }, code: '118430', dev: 'PP-SB-014', ch: 'WS Business', state: 'posted' },
    { id: 'T-3382', site: 'pp', acct: 'Kai', phone: '+855 96 552 4401', bind: { addr: '175.100.8.64', port: '3128', user: 'res_pp07', pw: 'Wp8*jl4R' }, shot: { addr: '175.100.8.64', port: '3128', user: 'res_pp07', pw: 'Wp8*jl4R' }, code: '', dev: 'PP-SB-019', ch: 'WS Business', state: 'done' },
    { id: 'T-3381', site: 'pp', acct: 'William', phone: '+855 96 972 5409', bind: { addr: '175.100.8.55', port: '3128', user: 'res_pp03', pw: 'Rt3*ml9G' }, shot: { addr: '175.100.8.55', port: '3128', user: 'res_pp03', pw: 'Rt3*ml9G' }, code: '', dev: 'PP-SB-015', ch: 'WS Normal', state: 'done' },
  ],
};

export const GOVERNANCE_DATA = {
  all: {
    supply: [
      { name: 'Registering', cur: 38, healthy: 50 },
      { name: 'Nurturing Pool', cur: 213, healthy: 240 },
      { name: 'Warmed Accounts', cur: 486, countOnly: true },
      { name: 'In Business Use', cur: 512, healthy: 512 },
    ],
    ban: [
      { name: 'At Registration', val: 12 },
      { name: 'Manual Nurture', val: 15 },
      { name: 'Auto Nurture', val: 9 },
      { name: 'In Use', val: 6 },
    ],
    banOverall: '23%',
    recRate: '54%',
    recDetail: '48 attempts · 26 success · 22 failed',
    recReason: [
      { l: 'SIM card issue', v: 40, tone: 'danger' },
      { l: 'Code received but failed', v: 35, tone: 'warn' },
      { l: 'Permanently banned', v: 25, tone: 'muted' },
    ],
    simDue: 5,
    simSoon: 3,
    tkPending: 3,
    tkAvg: '6 min',
    tkBacklog: 1,
    tkDone: '88%',
    tkReject: '12%',
    rejReason: [
      { l: 'IP mismatch', v: 70, tone: 'danger' },
      { l: 'Unclear screenshot', v: 20, tone: 'warn' },
      { l: 'Other', v: 10, tone: 'muted' },
    ],
  },
  my: {
    supply: [
      { name: 'Registering', cur: 26, healthy: 32 },
      { name: 'Nurturing Pool', cur: 140, healthy: 155 },
      { name: 'Warmed Accounts', cur: 310, countOnly: true },
      { name: 'In Business Use', cur: 330, healthy: 330 },
    ],
    ban: [
      { name: 'At Registration', val: 10 },
      { name: 'Manual Nurture', val: 13 },
      { name: 'Auto Nurture', val: 7 },
      { name: 'In Use', val: 5 },
    ],
    banOverall: '19%',
    recRate: '58%',
    recDetail: '30 attempts · 17 success · 13 failed',
    recReason: [
      { l: 'SIM card issue', v: 38, tone: 'danger' },
      { l: 'Code received but failed', v: 37, tone: 'warn' },
      { l: 'Permanently banned', v: 25, tone: 'muted' },
    ],
    simDue: 3,
    simSoon: 2,
    tkPending: 2,
    tkAvg: '5 min',
    tkBacklog: 0,
    tkDone: '90%',
    tkReject: '10%',
    rejReason: [
      { l: 'IP mismatch', v: 68, tone: 'danger' },
      { l: 'Unclear screenshot', v: 22, tone: 'warn' },
      { l: 'Other', v: 10, tone: 'muted' },
    ],
  },
  pp: {
    supply: [
      { name: 'Registering', cur: 12, healthy: 18 },
      { name: 'Nurturing Pool', cur: 73, healthy: 85 },
      { name: 'Warmed Accounts', cur: 176, countOnly: true },
      { name: 'In Business Use', cur: 182, healthy: 182 },
    ],
    ban: [
      { name: 'At Registration', val: 15 },
      { name: 'Manual Nurture', val: 18 },
      { name: 'Auto Nurture', val: 12 },
      { name: 'In Use', val: 8 },
    ],
    banOverall: '29%',
    recRate: '48%',
    recDetail: '18 attempts · 9 success · 9 failed',
    recReason: [
      { l: 'SIM card issue', v: 44, tone: 'danger' },
      { l: 'Code received but failed', v: 31, tone: 'warn' },
      { l: 'Permanently banned', v: 25, tone: 'muted' },
    ],
    simDue: 2,
    simSoon: 1,
    tkPending: 1,
    tkAvg: '8 min',
    tkBacklog: 1,
    tkDone: '85%',
    tkReject: '15%',
    rejReason: [
      { l: 'IP mismatch', v: 73, tone: 'danger' },
      { l: 'Unclear screenshot', v: 17, tone: 'warn' },
      { l: 'Other', v: 10, tone: 'muted' },
    ],
  },
};

export function hubTaskTotal() {
  return HUB_STAFF.reduce((a, p) => a + p.reg + p.rec + p.man + p.scan + p.tk, 0);
}

/** Pre-provisioned numbers queue — keyed by site */
export const REG_QUEUE = {
  my: [
    { id: 'r1', phone: '+60 11-2204 5570', telco: 'Outsource', need: true, note: 'Recovery failed — slot freed' },
    { id: 'r2', phone: '+60 11-2204 5571', telco: 'Tunetalk', need: true, note: 'Supply: registration pipeline below target' },
    { id: 'r3', phone: '+60 11-2204 5572', telco: 'Tunetalk', need: true, note: 'Supply: registration pipeline below target' },
    { id: 'r4', phone: '+60 11-2204 5573', telco: 'Outsource', need: false, note: '' },
    { id: 'r5', phone: '+60 11-2204 5574', telco: 'Tunetalk', need: false, note: '' },
    { id: 'r6', phone: '+60 11-2204 5575', telco: 'Digi', need: true, note: 'Replacement batch MY-06' },
    { id: 'r7', phone: '+60 11-2204 5576', telco: 'Celcom', need: false, note: '' },
  ],
  pp: [
    { id: 'r8', phone: '+855 96 553 0100', telco: 'Outsource', need: true, note: 'Recovery failed — slot freed' },
    { id: 'r9', phone: '+855 96 553 0101', telco: 'Outsource', need: false, note: '' },
    { id: 'r10', phone: '+855 96 553 0102', telco: 'Smart', need: true, note: 'Standby pool refill PP' },
    { id: 'r11', phone: '+855 96 553 0103', telco: 'Outsource', need: false, note: '' },
    { id: 'r12', phone: '+855 96 553 0104', telco: 'Smart', need: true, note: 'Joyce recovery slot' },
  ],
};

export const REG_DEVICES = {
  my: ['MYR-SB-003', 'MYR-SB-007', 'MYR-SB-012', 'MYR-SB-013', 'MYR-SB-016'],
  pp: ['PP-SB-016', 'PP-SB-019', 'PP-SB-022'],
};

export const IP_FREE = {
  my: ['103.21.44.25', '103.21.44.26', '103.21.44.27'],
  pp: ['175.100.8.70', '175.100.8.71'],
};

/** Demo account seed — single source for demo.js buildSeedAccounts() */
export const DEMO_ACCOUNT_SEED = [
  { id: 'acc-001', account_name: 'SBMY ela', phone_number: '+60105299493', status: 'IN_USE', device: 'MYR-SB-001', channel: 'WS Normal', site_key: 'my', ip_id: 'ip1', sim_id: 's1', owner: 'Alex', wsaf_slot: 0 },
  { id: 'acc-002', account_name: 'SBMY Zara', phone_number: '+601161761052', status: 'IN_USE', device: 'MYR-SB-001', channel: 'WS Business', site_key: 'my', ip_id: 'ip12', sim_id: 's2', owner: 'Alex', wsaf_slot: 1 },
  { id: 'acc-003', account_name: 'SBMY mey', phone_number: '+60108066584', status: 'AVAILABLE', device: 'MYR-SB-002', channel: 'WS Normal', site_key: 'my', ip_id: 'ip13', sim_id: 's3', owner: 'Bryan' },
  { id: 'acc-004', account_name: 'SBMY andy', phone_number: '+60107942539', status: 'NURTURING', device: 'MYR-SB-002', channel: 'WS Business', site_key: 'my', ip_id: 'ip14', sim_id: 's9', owner: 'Bryan', nurturing_phase: 'auto', nurturing_day: 5 },
  { id: 'acc-005', account_name: 'Janice', phone_number: '+60108152653', status: 'RECOVERING', device: 'MYR-SB-003', channel: 'WS Normal', site_key: 'my', ip_id: 'ip2', sim_id: 's10', owner: 'Geri', recovery: { recovery_status: 'doing', ban_stage: 'auto', ban_reason: 'Verification failed', log: [{ st: 'need', time: '2026-06-12T09:10:00.000Z', by: 'System' }, { st: 'doing', time: '2026-06-12T09:42:00.000Z', by: 'Seavmey' }] } },
  { id: 'acc-006', account_name: 'Susan', phone_number: '+60117311517', status: 'BANNED', device: 'MYR-SB-003', channel: 'WS Business', site_key: 'my', ip_id: 'ip2', sim_id: 's6', owner: 'Geri', recovery: { recovery_status: 'need', ban_stage: 'manual', ban_reason: 'Device / SIM issue', log: [{ st: 'need', time: '2026-06-11T14:20:00.000Z', by: 'System' }] } },
  { id: 'nm1', account_name: 'SBMY ela2', phone_number: '+601122045580', status: 'NURTURING', device: 'MYR-SB-005', channel: 'WS Normal', site_key: 'my', ip_id: 'ip15', sim_id: 's11', owner: 'Alex', nurturing_phase: 'manual', nurturing_day: 2 },
  { id: 'acc-007', account_name: 'SBMY ela3', phone_number: '+601122045571', status: 'AVAILABLE', device: 'MYR-SB-005', channel: 'WS Normal', site_key: 'my', ip_id: 'ip16', sim_id: 's12', owner: 'Alex' },
  { id: 'acc-008', account_name: 'Rita', phone_number: '+601190012211', status: 'IN_USE', device: 'MYR-SB-006', channel: 'WS Normal', site_key: 'my', ip_id: 'ip17', sim_id: 's13', owner: 'Bryan', wsaf_slot: 2 },
  { id: 'acc-009', account_name: 'Dora', phone_number: '+601133401188', status: 'AVAILABLE', device: 'MYR-SB-006', channel: 'WS Business', site_key: 'my', ip_id: 'ip18', sim_id: 's14', owner: 'Geri' },
  { id: 'na1', account_name: 'Oliver2', phone_number: '+60107706093', status: 'NURTURING', device: 'MYR-SB-008', channel: 'WS Normal', site_key: 'my', ip_id: 'ip3', sim_id: 's8', owner: 'Geri', nurturing_phase: 'auto', nurturing_day: 6 },
  { id: 'na2', account_name: 'Pam', phone_number: '+601188004412', status: 'NURTURING', device: 'MYR-SB-008', channel: 'WS Business', site_key: 'my', ip_id: 'ip19', sim_id: 's15', owner: 'Geri', nurturing_phase: 'auto', nurturing_day: 4 },
  { id: 'nm2', account_name: 'Cindy', phone_number: '+601155003311', status: 'NURTURING', device: 'MYR-SB-009', channel: 'WS Normal', site_key: 'my', ip_id: 'ip7', sim_id: 's16', owner: 'Alex', nurturing_phase: 'manual', nurturing_day: 3 },
  { id: 'nm4', account_name: 'Marcus', phone_number: '+601155003312', status: 'NURTURING', device: 'MYR-SB-009', channel: 'WS Business', site_key: 'my', ip_id: 'ip8', sim_id: 's17', owner: 'Alex', nurturing_phase: 'manual', nurturing_day: 1 },
  { id: 'nm5', account_name: 'Leah', phone_number: '+601166007722', status: 'NURTURING', device: 'MYR-SB-011', channel: 'WS Normal', site_key: 'my', ip_id: 'ip9', sim_id: 's18', owner: 'Bryan', nurturing_phase: 'manual', nurturing_day: 2 },
  { id: 'nm6', account_name: 'Theo', phone_number: '+601166007723', status: 'NURTURING', device: 'MYR-SB-011', channel: 'WS Business', site_key: 'my', ip_id: 'ip20', sim_id: 's19', owner: 'Bryan', nurturing_phase: 'manual', nurturing_day: 3 },
  { id: 'na5', account_name: 'Grace', phone_number: '+601199008811', status: 'NURTURING', device: 'MYR-SB-007', channel: 'WS Normal', site_key: 'my', ip_id: 'ip21', sim_id: 's20', owner: 'Geri', nurturing_phase: 'auto', nurturing_day: 5 },
  { id: 'na6', account_name: 'Hugo', phone_number: '+601199008812', status: 'NURTURING', device: 'MYR-SB-010', channel: 'WS Business', site_key: 'my', ip_id: 'ip22', sim_id: 's21', owner: 'Alex', nurturing_phase: 'auto', nurturing_day: 7 },
  { id: 'acc-010', account_name: 'Lina', phone_number: '+855969687960', status: 'AVAILABLE', device: 'PP-SB-014', channel: 'WS Normal', site_key: 'pp', ip_id: 'ip4', sim_id: 's4', owner: 'Alex' },
  { id: 'acc-011', account_name: 'Tamara', phone_number: '+855962274789', status: 'IN_USE', device: 'PP-SB-014', channel: 'WS Business', site_key: 'pp', ip_id: 'ip23', sim_id: 's5', owner: 'Alex', wsaf_slot: 3 },
  { id: 'nm3', account_name: 'William', phone_number: '+855969725409', status: 'NURTURING', device: 'PP-SB-015', channel: 'WS Normal', site_key: 'pp', ip_id: 'ip5', sim_id: 's22', owner: 'Bryan', nurturing_phase: 'manual', nurturing_day: 2 },
  { id: 'nm7', account_name: 'steven', phone_number: '+855969797581', status: 'NURTURING', device: 'PP-SB-015', channel: 'WS Business', site_key: 'pp', ip_id: 'ip6', sim_id: 's23', owner: 'Bryan', nurturing_phase: 'manual', nurturing_day: 2 },
  { id: 'acc-012', account_name: 'Joyce', phone_number: '+855963312200', status: 'BANNED', device: 'PP-SB-016', channel: 'WS Normal', site_key: 'pp', ip_id: 'ip24', sim_id: 's24', owner: 'Geri', recovery: { recovery_status: 'need', ban_stage: 'auto', ban_reason: 'Permanently banned by platform', log: [{ st: 'need', time: '2026-06-12T10:20:00.000Z', by: 'System' }] } },
  { id: 'nm8', account_name: 'Mia', phone_number: '+855963312201', status: 'NURTURING', device: 'PP-SB-016', channel: 'WS Business', site_key: 'pp', ip_id: 'ip25', sim_id: 's25', owner: 'Geri', nurturing_phase: 'manual', nurturing_day: 1 },
  { id: 'nm9', account_name: 'Ben', phone_number: '+855964413300', status: 'NURTURING', device: 'PP-SB-018', channel: 'WS Normal', site_key: 'pp', ip_id: 'ip26', sim_id: 's26', owner: 'Alex', nurturing_phase: 'manual', nurturing_day: 1 },
  { id: 'na4', account_name: 'Vera', phone_number: '+855964413301', status: 'NURTURING', device: 'PP-SB-018', channel: 'WS Business', site_key: 'pp', ip_id: 'ip27', sim_id: 's27', owner: 'Alex', nurturing_phase: 'auto', nurturing_day: 4 },
  { id: 'na3', account_name: 'Nina', phone_number: '+855965524400', status: 'NURTURING', device: 'PP-SB-019', channel: 'WS Normal', site_key: 'pp', ip_id: 'ip28', sim_id: 's28', owner: 'Bryan', nurturing_phase: 'auto', nurturing_day: 6 },
  { id: 'na7', account_name: 'Kai', phone_number: '+855965524401', status: 'NURTURING', device: 'PP-SB-019', channel: 'WS Business', site_key: 'pp', ip_id: 'ip29', sim_id: 's29', owner: 'Bryan', nurturing_phase: 'auto', nurturing_day: 5 },
  { id: 'rec2', account_name: 'Sammy', phone_number: '+855965095192', status: 'RECOVERING', device: 'PP-SB-022', channel: 'WS Normal', site_key: 'pp', ip_id: 'ip10', sim_id: 's7', owner: 'Geri', recovery: { recovery_status: 'doing', ban_stage: 'auto', ban_reason: 'Banned in Auto Nurturing', log: [{ st: 'need', time: '2026-06-12T08:55:00.000Z', by: 'System' }, { st: 'doing', time: '2026-06-12T11:05:00.000Z', by: 'Operator' }] } },
  { id: 'reg-1', account_name: 'SBMY-new01', phone_number: '+601122045590', status: 'REGISTERING', device: 'MYR-SB-012', channel: 'WS Normal', site_key: 'my', ip_id: 'ip7', sim_id: null, owner: 'Alex', prepared_telco: 'Tunetalk' },
  { id: 'reg-2', account_name: 'STMY-new02', phone_number: '+855965530105', status: 'REGISTERING', device: 'PP-SB-022', channel: 'WS Business', site_key: 'pp', ip_id: 'ip11', sim_id: null, owner: 'Bryan', prepared_telco: 'Outsource' },
  { id: 'lo-1', account_name: 'SBMY-log01', phone_number: '+601144556677', status: 'LOGGED_OUT', device: 'MYR-SB-013', channel: 'WS Business', site_key: 'my', ip_id: 'ip8', sim_id: 's30', owner: 'Geri', wsaf_slot: 4 },
  { id: 'lo-2', account_name: 'JMMY-log02', phone_number: '+601188990011', status: 'LOGGED_OUT', device: 'MYR-SB-016', channel: 'WS Normal', site_key: 'my', ip_id: 'ip9', sim_id: 's31', owner: 'Alex', wsaf_slot: 5 },
];

function nurtRowFromSeed(a) {
  return {
    id: a.id,
    acct: a.account_name,
    dev: a.device,
    ch: a.channel,
    day: a.nurturing_day,
  };
}

/** Manual nurturing (days 1–3) — derived from DEMO_ACCOUNT_SEED */
export const NURT_MAN = {
  my: DEMO_ACCOUNT_SEED.filter((a) => a.status === 'NURTURING' && a.nurturing_phase === 'manual' && a.site_key === 'my').map(nurtRowFromSeed),
  pp: DEMO_ACCOUNT_SEED.filter((a) => a.status === 'NURTURING' && a.nurturing_phase === 'manual' && a.site_key === 'pp').map(nurtRowFromSeed),
};

/** Auto nurturing (days 4–7, engine monitored) */
export const NURT_AUTO = {
  my: DEMO_ACCOUNT_SEED.filter((a) => a.status === 'NURTURING' && a.nurturing_phase === 'auto' && a.site_key === 'my').map(nurtRowFromSeed),
  pp: DEMO_ACCOUNT_SEED.filter((a) => a.status === 'NURTURING' && a.nurturing_phase === 'auto' && a.site_key === 'pp').map(nurtRowFromSeed),
};

/** Recovery queue — st: need | doing | ok | fail */
export const REC_QUEUE = {
  my: [
    {
      id: 'rec1',
      acct: 'Susan',
      dev: 'MYR-SB-003',
      ch: 'WS Business',
      from: 'Banned in Manual Nurturing',
      sim: 'Outsource · SIM-0251',
      st: 'doing',
      log: [
        { st: 'need', time: '2026-06-12 09:10', by: 'System' },
        { st: 'doing', time: '2026-06-12 09:42', by: 'Seavmey' },
      ],
    },
  ],
  pp: [
    {
      id: 'rec2',
      acct: 'Sammy',
      dev: 'PP-SB-022',
      ch: 'WS Normal',
      from: 'Banned in Auto Nurturing',
      sim: 'Outsource · SIM-0310',
      st: 'need',
      log: [{ st: 'need', time: '2026-06-12 08:55', by: 'System' }],
    },
    {
      id: 'rec3',
      acct: 'Joyce',
      dev: 'PP-SB-016',
      ch: 'WS Business',
      from: 'Banned in Business Use',
      sim: 'Outsource · SIM-0288',
      st: 'need',
      log: [{ st: 'need', time: '2026-06-12 10:20', by: 'System' }],
    },
  ],
};

export const REC_STATUS = {
  need: { label: RECOVERY_STATUS.need, pill: 'badge-danger' },
  doing: { label: RECOVERY_STATUS.doing, pill: 'badge-warn' },
  ok: { label: RECOVERY_STATUS.ok, pill: 'badge-success' },
  fail: { label: RECOVERY_STATUS.fail, pill: 'badge-default' },
};

export const REC_FAIL_REASONS = [
  'SIM issue (expired / not topped up / deactivated)',
  'Code received but recovery still failed',
  'Permanently banned by platform',
  'Other',
];

export function recElapsed(log, st) {
  if (!log?.length) return '—';
  const start = new Date(log[0].time.replace(' ', 'T'));
  const end = (st === 'ok' || st === 'fail')
    ? new Date(log[log.length - 1].time.replace(' ', 'T'))
    : new Date();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** IP ledger — 14 proxies */
export const IPS_LEDGER = [
  { id: 'ip1', ip_address: '103.21.44.12', port: '8080', username: 'res_my01', password: 'Px9$km2A', status: 'ACTIVE', risk_count: 2, in_use: 0 },
  { id: 'ip12', ip_address: '103.21.44.13', port: '8080', username: 'res_my01b', password: 'Px9$km2B', status: 'ACTIVE', risk_count: 1, in_use: 0 },
  { id: 'ip13', ip_address: '103.21.44.15', port: '8080', username: 'res_my02', password: 'Tz4!po8B', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip14', ip_address: '103.21.44.16', port: '8080', username: 'res_my02b', password: 'Tz4!po8C', status: 'ACTIVE', risk_count: 3, in_use: 0 },
  { id: 'ip2', ip_address: '103.21.44.19', port: '8080', username: 'res_my03', password: 'Qw7@nb1C', status: 'ACTIVE', risk_count: 9, in_use: 0 },
  { id: 'ip15', ip_address: '103.21.44.20', port: '8080', username: 'res_my04', password: 'Lm2#vc6D', status: 'ACTIVE', risk_count: 1, in_use: 0 },
  { id: 'ip16', ip_address: '103.21.44.21', port: '8080', username: 'res_my05', password: 'Vk2@np7Q', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip3', ip_address: '103.21.44.22', port: '8080', username: 'res_my04c', password: 'Lm2#vc6E', status: 'INACTIVE', risk_count: 5, in_use: 0 },
  { id: 'ip17', ip_address: '103.21.44.28', port: '8080', username: 'res_my08', password: 'Hm9#qw2L', status: 'ACTIVE', risk_count: 2, in_use: 0 },
  { id: 'ip18', ip_address: '103.21.44.30', port: '8080', username: 'res_my10', password: 'Zx4$mk1R', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip19', ip_address: '103.21.44.23', port: '8080', username: 'res_my11', password: 'Yv6@ws2M', status: 'ACTIVE', risk_count: 1, in_use: 0 },
  { id: 'ip7', ip_address: '103.21.44.25', port: '8080', username: 'res_my06', password: 'Yv6@ws2L', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip8', ip_address: '103.21.44.26', port: '8080', username: 'res_my06b', password: 'Yv6@ws2N', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip9', ip_address: '103.21.44.27', port: '8080', username: 'res_my07', password: 'Jc9#mn4P', status: 'ACTIVE', risk_count: 2, in_use: 0 },
  { id: 'ip20', ip_address: '103.21.44.29', port: '8080', username: 'res_my09', password: 'Jc9#mn4Q', status: 'ACTIVE', risk_count: 1, in_use: 0 },
  { id: 'ip21', ip_address: '103.21.44.31', port: '8080', username: 'res_my12', password: 'Df2&hk5Q', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip22', ip_address: '103.21.44.32', port: '8080', username: 'res_my13', password: 'Wp7*jl3R', status: 'ACTIVE', risk_count: 2, in_use: 0 },
  { id: 'ip4', ip_address: '175.100.8.41', port: '3128', username: 'res_pp01', password: 'Bn5%xz3E', status: 'ACTIVE', risk_count: 4, in_use: 0 },
  { id: 'ip23', ip_address: '175.100.8.42', port: '3128', username: 'res_pp02', password: 'Hk8&qw0F', status: 'ACTIVE', risk_count: 1, in_use: 0 },
  { id: 'ip5', ip_address: '175.100.8.55', port: '3128', username: 'res_pp03', password: 'Rt3*ml9G', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip6', ip_address: '175.100.8.56', port: '3128', username: 'res_pp03b', password: 'Rt3*ml9H', status: 'ACTIVE', risk_count: 7, in_use: 0 },
  { id: 'ip24', ip_address: '175.100.8.58', port: '3128', username: 'res_pp04', password: 'Df2&hk5S', status: 'ACTIVE', risk_count: 3, in_use: 0 },
  { id: 'ip25', ip_address: '175.100.8.59', port: '3128', username: 'res_pp04b', password: 'Df2&hk5T', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip26', ip_address: '175.100.8.61', port: '3128', username: 'res_pp05', password: 'Wp7*jl3S', status: 'ACTIVE', risk_count: 1, in_use: 0 },
  { id: 'ip27', ip_address: '175.100.8.62', port: '3128', username: 'res_pp05b', password: 'Wp7*jl3T', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip28', ip_address: '175.100.8.63', port: '3128', username: 'res_pp06', password: 'Lm3#rt9K', status: 'ACTIVE', risk_count: 2, in_use: 0 },
  { id: 'ip29', ip_address: '175.100.8.64', port: '3128', username: 'res_pp07', password: 'Wp8*jl4R', status: 'ACTIVE', risk_count: 0, in_use: 0 },
  { id: 'ip10', ip_address: '175.100.8.70', port: '3128', username: 'res_pp08', password: 'Df2&hk5U', status: 'ACTIVE', risk_count: 1, in_use: 0 },
  { id: 'ip11', ip_address: '175.100.8.71', port: '3128', username: 'res_pp09', password: 'Wp7*jl3U', status: 'ACTIVE', risk_count: 0, in_use: 0 },
];

/** SIM ledger — 14 cards */
export const SIMS_LEDGER = [
  { id: 's1', phone_number: '+60 10-529 9493', carrier: 'Tunetalk', location: 'Malaysia', account_name: 'SBMY ela', days_left: 2, last_charged: null },
  { id: 's2', phone_number: '+60 11-6176 1052', carrier: 'Outsource', location: 'Malaysia', account_name: 'SBMY Zara', days_left: 18, last_charged: '2026-06-01' },
  { id: 's3', phone_number: '+60 10-806 6584', carrier: 'Tunetalk', location: 'Malaysia', account_name: 'SBMY mey', days_left: 5, last_charged: null },
  { id: 's4', phone_number: '+855 96 968 7960', carrier: 'Outsource', location: 'Poipet', account_name: 'Lina', days_left: 1, last_charged: null },
  { id: 's5', phone_number: '+855 96 227 4789', carrier: 'Outsource', location: 'Poipet', account_name: 'Tamara', days_left: 25, last_charged: '2026-06-05' },
  { id: 's6', phone_number: '+60 11-7311 517', carrier: 'Outsource', location: 'Malaysia', account_name: 'Susan', days_left: 6, last_charged: null },
  { id: 's7', phone_number: '+855 96 509 5192', carrier: 'Outsource', location: 'Poipet', account_name: 'Sammy', days_left: 12, last_charged: null },
  { id: 's8', phone_number: '+60 10-770 6093', carrier: 'Tunetalk', location: 'Malaysia', account_name: 'Oliver2', days_left: 30, last_charged: '2026-05-28' },
  { id: 's9', phone_number: '+60 10-794 2539', carrier: 'Digi', location: 'Malaysia', account_name: 'SBMY andy', days_left: 14, last_charged: '2026-06-02' },
  { id: 's10', phone_number: '+60 10-815 2653', carrier: 'Celcom', location: 'Malaysia', account_name: 'Janice', days_left: 8, last_charged: null },
  { id: 's11', phone_number: '+60 11-2204 5580', carrier: 'Tunetalk', location: 'Malaysia', account_name: 'SBMY ela2', days_left: 22, last_charged: '2026-05-20' },
  { id: 's12', phone_number: '+60 11-2204 5571', carrier: 'Tunetalk', location: 'Malaysia', account_name: 'SBMY ela3', days_left: 19, last_charged: '2026-05-25' },
  { id: 's13', phone_number: '+60 11-9001 2211', carrier: 'Outsource', location: 'Malaysia', account_name: 'Rita', days_left: 11, last_charged: null },
  { id: 's14', phone_number: '+60 11-3340 1188', carrier: 'Digi', location: 'Malaysia', account_name: 'Dora', days_left: 16, last_charged: '2026-06-03' },
  { id: 's15', phone_number: '+60 11-8800 4412', carrier: 'Celcom', location: 'Malaysia', account_name: 'Pam', days_left: 7, last_charged: null },
  { id: 's16', phone_number: '+60 11-5500 3311', carrier: 'Tunetalk', location: 'Malaysia', account_name: 'Cindy', days_left: 4, last_charged: null },
  { id: 's17', phone_number: '+60 11-5500 3312', carrier: 'Tunetalk', location: 'Malaysia', account_name: 'Marcus', days_left: 28, last_charged: '2026-05-15' },
  { id: 's18', phone_number: '+60 11-6600 7722', carrier: 'Outsource', location: 'Malaysia', account_name: 'Leah', days_left: 3, last_charged: null },
  { id: 's19', phone_number: '+60 11-6600 7723', carrier: 'Outsource', location: 'Malaysia', account_name: 'Theo', days_left: 9, last_charged: null },
  { id: 's20', phone_number: '+60 11-9900 8811', carrier: 'Digi', location: 'Malaysia', account_name: 'Grace', days_left: 15, last_charged: '2026-06-04' },
  { id: 's21', phone_number: '+60 11-9900 8812', carrier: 'Celcom', location: 'Malaysia', account_name: 'Hugo', days_left: 21, last_charged: '2026-05-30' },
  { id: 's22', phone_number: '+855 96 972 5409', carrier: 'Smart', location: 'Poipet', account_name: 'William', days_left: 6, last_charged: null },
  { id: 's23', phone_number: '+855 96 979 7581', carrier: 'Smart', location: 'Poipet', account_name: 'steven', days_left: 10, last_charged: null },
  { id: 's24', phone_number: '+855 96 331 2200', carrier: 'Outsource', location: 'Poipet', account_name: 'Joyce', days_left: 0, last_charged: null },
  { id: 's25', phone_number: '+855 96 331 2201', carrier: 'Outsource', location: 'Poipet', account_name: 'Mia', days_left: 13, last_charged: null },
  { id: 's26', phone_number: '+855 96 441 3300', carrier: 'Smart', location: 'Poipet', account_name: 'Ben', days_left: 17, last_charged: '2026-06-01' },
  { id: 's27', phone_number: '+855 96 441 3301', carrier: 'Smart', location: 'Poipet', account_name: 'Vera', days_left: 20, last_charged: '2026-05-27' },
  { id: 's28', phone_number: '+855 96 552 4400', carrier: 'Outsource', location: 'Poipet', account_name: 'Nina', days_left: 5, last_charged: null },
  { id: 's29', phone_number: '+855 96 552 4401', carrier: 'Outsource', location: 'Poipet', account_name: 'Kai', days_left: 24, last_charged: '2026-06-06' },
  { id: 's30', phone_number: '+60 14-4556 6777', carrier: 'Digi', location: 'Malaysia', account_name: 'SBMY-log01', days_left: 2, last_charged: null },
  { id: 's31', phone_number: '+60 18-8990 0111', carrier: 'Celcom', location: 'Malaysia', account_name: 'JMMY-log02', days_left: 8, last_charged: null },
];

export const FEEDING_AUDIT_LOG = [
  { id: 'fa1', ts: new Date().toISOString(), dateTime: '19/06/2026, 14:32:10', accountName: 'Oliver2', location: 'Malaysia', feedingDays: 'D6', feedingStatus: 'Success', ipAddress: '103.21.44.22' },
  { id: 'fa2', ts: new Date(Date.now() - 900000).toISOString(), dateTime: '19/06/2026, 14:17:44', accountName: 'Pam', location: 'Malaysia', feedingDays: 'D4', feedingStatus: 'Success', ipAddress: '103.21.44.23' },
  { id: 'fa3', ts: new Date(Date.now() - 1800000).toISOString(), dateTime: '19/06/2026, 14:02:44', accountName: 'SBMY andy', location: 'Malaysia', feedingDays: 'D5', feedingStatus: 'Success', ipAddress: '103.21.44.16' },
  { id: 'fa4', ts: new Date(Date.now() - 2700000).toISOString(), dateTime: '19/06/2026, 13:47:18', accountName: 'Nina', location: 'Poipet', feedingDays: 'D6', feedingStatus: 'Restrict', ipAddress: '175.100.8.63' },
  { id: 'fa5', ts: new Date(Date.now() - 3600000).toISOString(), dateTime: '19/06/2026, 13:32:18', accountName: 'Kai', location: 'Poipet', feedingDays: 'D5', feedingStatus: 'Success', ipAddress: '175.100.8.64' },
  { id: 'fa6', ts: new Date(Date.now() - 4500000).toISOString(), dateTime: '19/06/2026, 13:17:05', accountName: 'Vera', location: 'Poipet', feedingDays: 'D4', feedingStatus: 'Success', ipAddress: '175.100.8.62' },
  { id: 'fa7', ts: new Date(Date.now() - 5400000).toISOString(), dateTime: '19/06/2026, 13:02:51', accountName: 'Grace', location: 'Malaysia', feedingDays: 'D5', feedingStatus: 'Success', ipAddress: '103.21.44.31' },
  { id: 'fa8', ts: new Date(Date.now() - 6300000).toISOString(), dateTime: '19/06/2026, 12:47:33', accountName: 'Hugo', location: 'Malaysia', feedingDays: 'D7', feedingStatus: 'Success', ipAddress: '103.21.44.32' },
  { id: 'fa9', ts: new Date(Date.now() - 7200000).toISOString(), dateTime: '19/06/2026, 12:32:05', accountName: 'Tamara', location: 'Poipet', feedingDays: 'In Use', feedingStatus: 'Success', ipAddress: '175.100.8.42' },
  { id: 'fa10', ts: new Date(Date.now() - 8100000).toISOString(), dateTime: '19/06/2026, 12:17:22', accountName: 'SBMY ela', location: 'Malaysia', feedingDays: 'In Use', feedingStatus: 'Success', ipAddress: '103.21.44.12' },
  { id: 'fa11', ts: new Date(Date.now() - 9000000).toISOString(), dateTime: '19/06/2026, 12:02:18', accountName: 'Rita', location: 'Malaysia', feedingDays: 'In Use', feedingStatus: 'Restrict', ipAddress: '103.21.44.28' },
  { id: 'fa12', ts: new Date(Date.now() - 9900000).toISOString(), dateTime: '19/06/2026, 11:47:44', accountName: 'Susan', location: 'Malaysia', feedingDays: 'D3', feedingStatus: 'Banned', ipAddress: '103.21.44.19' },
];

export const AUDIT_LOG = [
  { id: 'al1', action: 'STATE_CHANGE', entity_type: 'account', entity_id: 'acc-008', created_at: new Date().toISOString(), profiles: { full_name: 'Demo Admin', email: 'demo@ams.local' }, metadata: { from: 'AVAILABLE', to: 'IN_USE' } },
  { id: 'al2', action: 'TICKET_CREATE', entity_type: 'ticket', entity_id: 'tk-t-3391', created_at: new Date(Date.now() - 1800000).toISOString(), profiles: { full_name: 'Business User', email: 'biz@ams.local' }, metadata: { title: 'Delivery — SBMY mey' } },
  { id: 'al3', action: 'CREATE', entity_type: 'account', entity_id: 'reg-1', created_at: new Date(Date.now() - 3600000).toISOString(), profiles: { full_name: 'RM Executor 1', email: 'rm1@ams.local' }, metadata: { account_name: 'SBMY-new01' } },
  { id: 'al4', action: 'UPDATE', entity_type: 'ip', entity_id: 'ip2', created_at: new Date(Date.now() - 7200000).toISOString(), profiles: { full_name: 'Demo Admin', email: 'demo@ams.local' }, metadata: { field: 'risk_count', value: 9 } },
  { id: 'al5', action: 'UPDATE', entity_type: 'sim', entity_id: 's24', created_at: new Date(Date.now() - 86400000).toISOString(), profiles: { full_name: 'RM Executor 2', email: 'rm2@ams.local' }, metadata: { days_left: 0 } },
  { id: 'al6', action: 'STATE_CHANGE', entity_type: 'account', entity_id: 'acc-006', created_at: new Date(Date.now() - 90000000).toISOString(), profiles: { full_name: 'Seavmey', email: 'seav@ams.local' }, metadata: { from: 'NURTURING', to: 'BANNED' } },
  { id: 'al7', action: 'STATE_CHANGE', entity_type: 'account', entity_id: 'acc-005', created_at: new Date(Date.now() - 93600000).toISOString(), profiles: { full_name: 'Seavmey', email: 'seav@ams.local' }, metadata: { from: 'BANNED', to: 'RECOVERING' } },
  { id: 'al8', action: 'TICKET_CREATE', entity_type: 'ticket', entity_id: 'tk-t-3390', created_at: new Date(Date.now() - 108000000).toISOString(), profiles: { full_name: 'Business User', email: 'biz@ams.local' }, metadata: { title: 'Delivery — Lina' } },
  { id: 'al9', action: 'UPDATE', entity_type: 'account', entity_id: 'na1', created_at: new Date(Date.now() - 129600000).toISOString(), profiles: { full_name: 'Demo Admin', email: 'demo@ams.local' }, metadata: { nurturing_phase: 'auto' } },
  { id: 'al10', action: 'DELETE', entity_type: 'ip', entity_id: 'ip-old', created_at: new Date(Date.now() - 172800000).toISOString(), profiles: { full_name: 'Demo Admin', email: 'demo@ams.local' }, metadata: { ip_address: '192.168.0.99' } },
  { id: 'al11', action: 'STATE_CHANGE', entity_type: 'account', entity_id: 'lo-1', created_at: new Date(Date.now() - 200000000).toISOString(), profiles: { full_name: 'System', email: 'system@ams.local' }, metadata: { from: 'IN_USE', to: 'LOGGED_OUT' } },
  { id: 'al12', action: 'CREATE', entity_type: 'registration', entity_id: 'reg-seed-3', created_at: new Date(Date.now() - 259200000).toISOString(), profiles: { full_name: 'RM Executor 1', email: 'rm1@ams.local' }, metadata: { phone_number: '+601122045572', result: 'ok' } },
];

/** Registration log seed — 12 entries */
export const DEMO_REG_LOGS = [
  { id: 'reg-seed-1', phone_number: '+60177888999', telco: 'Digi', site_key: 'my', result: 'ok', account_name: 'SBMY-004', operator: 'Demo Admin', created_at: new Date(Date.now() - 86400000 * 5).toISOString() },
  { id: 'reg-seed-2', phone_number: '+60199000001', telco: 'Celcom', site_key: 'my', result: 'fail', fail_reason: 'No verification code', operator: 'Demo Admin', created_at: new Date(Date.now() - 86400000 * 4).toISOString() },
  { id: 'reg-seed-3', phone_number: '+601122045572', telco: 'Tunetalk', site_key: 'my', result: 'ok', account_name: 'Cindy', operator: 'RM Executor 1', created_at: new Date(Date.now() - 86400000 * 3).toISOString() },
  { id: 'reg-seed-4', phone_number: '+601155003311', telco: 'Tunetalk', site_key: 'my', result: 'ok', account_name: 'Cindy', operator: 'RM Executor 1', created_at: new Date(Date.now() - 86400000 * 3 + 3600000).toISOString() },
  { id: 'reg-seed-5', phone_number: '+601188004412', telco: 'Celcom', site_key: 'my', result: 'fail', fail_reason: 'SIM not active', operator: 'RM Executor 2', created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: 'reg-seed-6', phone_number: '+855965524400', telco: 'Smart', site_key: 'pp', result: 'ok', account_name: 'Nina', operator: 'PP Executor 1', created_at: new Date(Date.now() - 86400000 * 2 + 7200000).toISOString() },
  { id: 'reg-seed-7', phone_number: '+855964413300', telco: 'Outsource', site_key: 'pp', result: 'ok', account_name: 'Ben', operator: 'PP Executor 1', created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'reg-seed-8', phone_number: '+855963312200', telco: 'Outsource', site_key: 'pp', result: 'fail', fail_reason: 'Number rejected by platform', operator: 'PP Executor 2', created_at: new Date(Date.now() - 43200000).toISOString() },
  { id: 'reg-seed-9', phone_number: '+601122045590', telco: 'Tunetalk', site_key: 'my', result: 'ok', account_name: 'SBMY-new01', operator: 'Demo Admin', created_at: new Date(Date.now() - 21600000).toISOString() },
  { id: 'reg-seed-10', phone_number: '+855965530105', telco: 'Outsource', site_key: 'pp', result: 'ok', account_name: 'STMY-new02', operator: 'PP Executor 2', created_at: new Date(Date.now() - 10800000).toISOString() },
  { id: 'reg-seed-11', phone_number: '+601166007722', telco: 'Outsource', site_key: 'my', result: 'fail', fail_reason: 'Device / SIM issue', operator: 'RM Executor 2', created_at: new Date(Date.now() - 5400000).toISOString() },
  { id: 'reg-seed-12', phone_number: '+855969725409', telco: 'Smart', site_key: 'pp', result: 'ok', account_name: 'William', operator: 'PP Executor 1', created_at: new Date(Date.now() - 1800000).toISOString() },
];

export const DEVICES_LIST = [
  { id: 'd1', device_name: 'MYR-SB-001', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-001', notes: '_ams_loc:{"shelf":"Shelf A · Slot 1"}' },
  { id: 'd2', device_name: 'MYR-SB-002', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-002', notes: '_ams_loc:{"shelf":"Shelf A · Slot 2"}' },
  { id: 'd3', device_name: 'MYR-SB-003', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-003', notes: '_ams_loc:{"shelf":"Shelf A · Slot 3"}' },
  { id: 'd6', device_name: 'MYR-SB-005', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-005', notes: '_ams_loc:{"shelf":"Shelf A · Slot 5"}' },
  { id: 'd14', device_name: 'MYR-SB-006', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-006', notes: '_ams_loc:{"shelf":"Shelf A · Slot 6"}' },
  { id: 'd7', device_name: 'MYR-SB-007', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-007', notes: '_ams_loc:{"shelf":"Shelf A · Slot 7"}' },
  { id: 'd15', device_name: 'MYR-SB-008', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-008', notes: '_ams_loc:{"shelf":"Shelf A · Slot 8"}' },
  { id: 'd8', device_name: 'MYR-SB-009', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-009', notes: '_ams_loc:{"shelf":"Shelf A · Slot 9"}' },
  { id: 'd16', device_name: 'MYR-SB-010', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-010', notes: '_ams_loc:{"shelf":"Shelf A · Slot 10"}' },
  { id: 'd17', device_name: 'MYR-SB-011', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-011', notes: '_ams_loc:{"shelf":"Shelf A · Slot 11"}' },
  { id: 'd18', device_name: 'MYR-SB-012', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-012', notes: '_ams_loc:{"shelf":"Shelf A · Slot 12"}' },
  { id: 'd9', device_name: 'MYR-SB-013', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-013', notes: '_ams_loc:{"shelf":"Shelf A · Slot 13"}' },
  { id: 'd10', device_name: 'MYR-SB-016', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-MY-016', notes: '_ams_loc:{"shelf":"Shelf A · Slot 16"}' },
  { id: 'd4', device_name: 'PP-SB-014', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-PP-014', notes: '_ams_loc:{"shelf":"Shelf B · Slot 2"}' },
  { id: 'd19', device_name: 'PP-SB-015', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-PP-015', notes: '_ams_loc:{"shelf":"Shelf B · Slot 5"}' },
  { id: 'd11', device_name: 'PP-SB-016', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-PP-016', notes: '_ams_loc:{"shelf":"Shelf B · Slot 4"}' },
  { id: 'd12', device_name: 'PP-SB-018', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-PP-018', notes: '_ams_loc:{"shelf":"Shelf B · Slot 6"}' },
  { id: 'd20', device_name: 'PP-SB-019', brand: 'Samsung', status: 'ACTIVE', serial_number: 'SN-PP-019', notes: '_ams_loc:{"shelf":"Shelf B · Slot 3"}' },
  { id: 'd5', device_name: 'PP-SB-022', brand: 'Samsung', status: 'MAINTENANCE', serial_number: 'SN-PP-022', notes: '_ams_loc:{"shelf":"Shelf B · Slot 7"}' },
];
