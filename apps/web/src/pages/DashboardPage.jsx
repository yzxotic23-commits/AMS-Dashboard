import { useQuery } from '@tanstack/react-query';
import {
  Users, CheckCircle, Activity, Ban, LogOut, Smartphone, CreditCard, Globe,
  ClipboardList, Shield, TrendingUp, TrendingDown,
} from 'lucide-react';
import api from '../lib/api';

/* ─── Stat card matching Figma overview cards ─── */
function StatCard({ icon: Icon, label, value, iconBg, trend, trendLabel }) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : null;
  return (
    <div
      className="flex flex-col gap-5 rounded-[14px] p-[18px]"
      style={{ background: 'rgba(255,255,255,0.34)' }}
    >
      <div className="flex flex-col gap-5">
        <div
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[26px]"
          style={{ background: iconBg }}
        >
          <Icon size={22} strokeWidth={1.75} className="text-white" />
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="text-[14px] text-ams-muted">{label}</p>
          <p className="text-[28px] font-semibold leading-none tracking-tight text-ams-ink">
            {value ?? '—'}
          </p>
        </div>
      </div>
      {TrendIcon && trendLabel && (
        <div className="flex items-center gap-1">
          <TrendIcon size={14} className={trend === 'up' ? 'text-ams-success' : 'text-ams-danger'} />
          <span className="text-[10px] tracking-[0.2px] text-ams-ink">{trendLabel}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Radial gauge (semi-circle) ─── */
function RadialGauge({ pct = 72, label = 'Completed' }) {
  const R = 80;
  const cx = 100;
  const cy = 96;
  const circumference = Math.PI * R; // half circle
  const offset = circumference * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative">
        <svg width="200" height="120" viewBox="0 0 200 120">
          {/* track */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
            fill="none"
            stroke="rgba(6,6,6,0.08)"
            strokeWidth="16"
            strokeLinecap="round"
          />
          {/* fill */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
            fill="none"
            stroke="var(--ams-accent)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={`${offset}`}
          />
          {/* secondary arc (green) */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
            fill="none"
            stroke="var(--ams-success)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.27} ${circumference}`}
            strokeDashoffset="0"
            opacity="0.6"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <p className="text-[28px] font-semibold tracking-tight text-ams-ink">{pct}%</p>
          <p className="text-[14px] text-ams-muted">{label}</p>
        </div>
        {/* tick labels */}
        <span className="absolute bottom-0 left-2 text-[12px] text-ams-ink">0</span>
        <span className="absolute bottom-0 right-2 text-[12px] text-ams-ink">100</span>
      </div>
    </div>
  );
}

/* ─── Circular progress icon ─── */
function CircleProgress({ pct = 0, size = 32 }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(6,6,6,0.08)" strokeWidth="4" />
      <circle
        cx="16" cy="16" r={r}
        fill="none"
        stroke={pct >= 100 ? 'var(--ams-success)' : pct >= 50 ? 'var(--ams-accent)' : 'var(--ams-warn)'}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        strokeDashoffset={c / 4}
        transform="rotate(-90 16 16)"
      />
      <text x="16" y="20" textAnchor="middle" fontSize="8" fill="var(--ams-ink)" fontWeight="600">
        {pct}%
      </text>
    </svg>
  );
}

/* ─── Status badge ─── */
function StatusBadge({ status }) {
  const map = {
    open:        { bg: 'rgba(43,92,230,0.12)',   color: '#2b5ce6',              label: 'Open' },
    in_progress: { bg: 'rgba(230,95,43,0.18)',   color: 'var(--ams-accent)',    label: 'On going' },
    closed:      { bg: 'rgba(26,147,46,0.18)',   color: 'var(--ams-success)',   label: 'Completed' },
    pending:     { bg: 'rgba(223,165,16,0.18)',  color: 'var(--ams-warn)',      label: 'Delayed' },
    at_risk:     { bg: 'rgba(238,32,28,0.18)',   color: 'var(--ams-danger)',    label: 'At risk' },
  };
  const cfg = map[status] ?? { bg: 'rgba(6,6,6,0.06)', color: 'var(--ams-muted)', label: status };
  return (
    <span
      className="inline-flex items-center rounded-[20px] px-2.5 py-[5px] text-[12px] tracking-[0.12px]"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

/* ─── Panel wrapper (translucent white, Figma style) ─── */
function Panel({ children, className = '' }) {
  return (
    <div
      className={`rounded-[14px] p-[18px] ${className}`}
      style={{ background: 'rgba(255,255,255,0.34)' }}
    >
      {children}
    </div>
  );
}

function PanelTitle({ children }) {
  return (
    <h2 className="text-[16px] font-normal tracking-[0.16px] text-ams-ink">{children}</h2>
  );
}

/* ─── Filter pill ─── */
function FilterPill({ children }) {
  return (
    <div className="flex h-[34px] items-center gap-2 rounded-[17px] bg-white px-3.5 py-[2px] text-[14px] tracking-[0.14px] text-ams-ink shadow-sm cursor-pointer select-none">
      {children}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

/* ─── Main dashboard ─── */
export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ams-line border-t-ams-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[14px] p-6 text-ams-danger" style={{ background: 'rgba(255,255,255,0.34)' }}>
        Failed to load dashboard: {error.message}
        <p className="mt-2 text-xs text-ams-muted">
          Make sure the SQL migration has been run in Supabase and API keys are correct.
        </p>
      </div>
    );
  }

  const s = data?.stats || {};

  const totalAccounts = s.total_accounts ?? 0;
  const available = s.available_accounts ?? 0;
  const inUse = s.in_use_accounts ?? 0;
  const banned = s.banned_accounts ?? 0;
  const completePct = totalAccounts > 0 ? Math.round((available / totalAccounts) * 100) : 0;

  const recentTickets = data?.recentTickets ?? [];
  const recentActivity = data?.recentActivity ?? [];

  return (
    <div>
      {/* ── Page header ── */}
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-normal tracking-[0.22px] text-ams-ink">Overview</h1>
        <FilterPill>Last 30 days</FilterPill>
      </header>

      {/* ── Stat cards row ── */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Total Accounts"
          value={s.total_accounts}
          iconBg="#d398e7"
          trend="up"
          trendLabel="All registered accounts"
        />
        <StatCard
          icon={CheckCircle}
          label="Available"
          value={s.available_accounts}
          iconBg="#70a1e5"
          trend="up"
          trendLabel="Ready to use"
        />
        <StatCard
          icon={Activity}
          label="In Use"
          value={s.in_use_accounts}
          iconBg="#e89271"
          trend="down"
          trendLabel="Currently feeding"
        />
        <StatCard
          icon={Ban}
          label="Banned"
          value={s.banned_accounts}
          iconBg="#f0c274"
          trend="down"
          trendLabel="Flagged accounts"
        />
      </div>

      {/* ── Second stat row ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={LogOut}   label="Logged Out"   value={s.logged_out_accounts} iconBg="var(--ams-warn)" />
        <StatCard icon={Smartphone} label="Devices"    value={s.total_devices}       iconBg="#9b8fef" />
        <StatCard icon={CreditCard} label="SIM Cards"  value={s.total_sims}          iconBg="#6bbfad" />
        <StatCard icon={Globe}      label="Active IPs" value={s.total_ips}           iconBg="#e5a070" />
      </div>

      {/* ── Main two-column section ── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_auto]">

        {/* Left: Project / Ticket summary table */}
        <Panel>
          <div className="mb-6 flex items-center justify-between">
            <PanelTitle>Ticket Summary</PanelTitle>
            <div className="flex gap-2">
              <FilterPill>Status</FilterPill>
            </div>
          </div>

          {/* Table header */}
          <div className="mb-3 grid text-[14px] font-normal tracking-[0.14px] text-ams-ink"
               style={{ gridTemplateColumns: '2fr 1fr 1.2fr 1fr' }}>
            <span>Title</span>
            <span>Priority</span>
            <span>Due date</span>
            <span>Status</span>
          </div>
          <div className="h-px w-full bg-ams-line mb-3" />

          {!recentTickets.length ? (
            <p className="py-6 text-center text-xs text-ams-faint">No tickets yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {recentTickets.map((t) => (
                <div
                  key={t.id}
                  className="grid items-center text-[14px] text-ams-ink"
                  style={{ gridTemplateColumns: '2fr 1fr 1.2fr 1fr' }}
                >
                  <span className="truncate pr-4">{t.title}</span>
                  <span className="text-ams-muted capitalize">{t.priority ?? '—'}</span>
                  <span className="text-ams-muted">
                    {t.due_date
                      ? new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Right: Overall Progress */}
        <Panel className="w-full lg:w-[400px]">
          <div className="mb-6 flex items-center justify-between">
            <PanelTitle>Overall Progress</PanelTitle>
            <FilterPill>All</FilterPill>
          </div>

          <div className="flex flex-col items-center gap-6">
            <RadialGauge pct={completePct} label="Available" />

            <div className="flex w-full justify-between">
              <div className="flex flex-col gap-1.5">
                <p className="text-[22px] font-semibold tracking-[0.22px] text-ams-ink">{totalAccounts}</p>
                <p className="text-[14px] text-ams-muted">Total accounts</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[22px] font-semibold tracking-[0.22px] text-ams-success">{available}</p>
                <p className="text-[14px] text-ams-muted">Available</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[22px] font-semibold tracking-[0.22px] text-ams-warn">{s.logged_out_accounts ?? 0}</p>
                <p className="text-[14px] text-ams-muted">Logged out</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[22px] font-semibold tracking-[0.22px] text-ams-accent">{inUse}</p>
                <p className="text-[14px] text-ams-muted">In use</p>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Bottom two panels ── */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">

        {/* Today's activity / Recent ops */}
        <Panel>
          <div className="mb-5 flex items-center justify-between">
            <PanelTitle>Recent Activity</PanelTitle>
          </div>
          <div className="mb-4 flex gap-6 border-b border-ams-line pb-3">
            {['All', 'Accounts', 'Feeding', 'Tickets'].map((tab, i) => (
              <button
                key={tab}
                className={`flex items-center gap-1.5 text-[14px] tracking-[0.14px] ${i === 0 ? 'text-ams-ink font-medium' : 'text-ams-ink/60'}`}
              >
                {tab}
                {i === 0 && (
                  <span className="rounded-[17px] bg-ams-blue/10 px-1.5 py-px text-[10px] font-normal text-ams-blue">
                    {recentActivity.length || 0}
                  </span>
                )}
              </button>
            ))}
          </div>
          {!recentActivity.length ? (
            <p className="py-4 text-center text-xs text-ams-faint">No activity yet.</p>
          ) : (
            <div className="flex flex-col gap-0">
              {recentActivity.map((a, idx) => (
                <div key={a.id} className="flex items-center justify-between border-b border-ams-line py-3 last:border-0">
                  <div className="flex items-center gap-2.5">
                    <div className="h-[18px] w-[18px] rounded-full bg-ams-success/20 flex items-center justify-center">
                      <CheckCircle size={10} className="text-ams-success" />
                    </div>
                    <span className="text-[14px] text-ams-ink">
                      <span className="font-medium">{a.action}</span>
                      <span className="text-ams-muted"> · {a.entity_type}</span>
                    </span>
                  </div>
                  <span className="shrink-0 text-[12px] text-ams-muted">
                    {new Date(a.created_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Resource / infrastructure overview */}
        <Panel>
          <div className="mb-5 flex items-center justify-between">
            <PanelTitle>Infrastructure Stats</PanelTitle>
          </div>
          <div className="flex flex-col gap-0">
            {[
              { icon: ClipboardList, label: 'Open Tickets',     value: s.open_tickets,     tone: 'warn' },
              { icon: Shield,        label: 'Pending IP Source',  value: s.pending_ip_gate,  tone: 'warn' },
              { icon: Smartphone,    label: 'Total Devices',    value: s.total_devices,    tone: 'default' },
              { icon: CreditCard,    label: 'Total SIM Cards',  value: s.total_sims,       tone: 'default' },
              { icon: Globe,         label: 'Active IPs',       value: s.total_ips,        tone: 'default' },
              { icon: LogOut,        label: 'Logged Out',       value: s.logged_out_accounts, tone: 'warn' },
            ].map(({ icon: Icon, label, value, tone }) => {
              const colMap = { warn: 'text-ams-warn', default: 'text-ams-ink', danger: 'text-ams-danger' };
              return (
                <div key={label} className="flex items-center justify-between border-b border-ams-line py-3 last:border-0">
                  <div className="flex items-center gap-2.5 text-ams-muted text-[14px]">
                    <Icon size={15} strokeWidth={1.75} />
                    {label}
                  </div>
                  <span className={`text-[22px] font-semibold tracking-[0.22px] ${colMap[tone]}`}>
                    {value ?? '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
