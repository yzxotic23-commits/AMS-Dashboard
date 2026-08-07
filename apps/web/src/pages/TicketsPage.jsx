import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, CircleX, Loader2, Plus, Search, Smartphone, XCircle } from 'lucide-react';
import PageHead from '../components/PageHead';
import DetailDialog from '../components/DetailDialog';
import ImageLightbox from '../components/ImageLightbox';
import Drawer from '../components/Drawer';
import IconTooltip from '../components/IconTooltip';
import ScreenshotReviewPanel from '../components/ScreenshotReviewPanel';
import TicketDetailsBlock from '../components/TicketDetailsBlock';
import StandbyAccountPicker from '../components/StandbyAccountPicker';
import Toast from '../components/Toast';
import SegControl from '../components/SegControl';
import ScreenshotUpload from '../components/ScreenshotUpload';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';
import { SITES, getSiteChipClass } from '../lib/sites';
import { useTickets, useTicketMutations, useStandbyForTickets } from '../hooks/useTickets';
import {
  DELIVERY_STEPS, REJECT_REASONS, REJECT_REASON_OTHER, ticketStatusMeta, ticketStepCursor, ticketBucket,
  ticketMatchesSearch, TICKETS_PAGE_SIZE,
} from '../lib/ticket-delivery';

const GROUPS = [
  { key: 'act', tabLabel: 'Needs action' },
  { key: 'prog', tabLabel: 'In progress' },
  { key: 'completed', tabLabel: 'Completed' },
  { key: 'history', tabLabel: 'History' },
];

/** Verdict IP review — styling sama dengan banner status (hijau = delivery complete). */
function IpReviewVerdict({ reviewMatch }) {
  const tone = reviewMatch === true ? 'ok' : reviewMatch === false ? 'bad' : 'wait';
  const label = reviewMatch === true
    ? 'IP match'
    : reviewMatch === false
      ? 'IP mismatch'
      : 'Review needed';
  const Icon = reviewMatch === true ? CheckCircle2 : reviewMatch === false ? XCircle : Loader2;

  return (
    <div className={`tk-banner tk-banner--${tone}`}>
      <Icon
        size={14}
        strokeWidth={2.25}
        className={reviewMatch == null ? 'shrink-0 animate-spin' : 'shrink-0'}
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

function DeliverySteps({ stage, reviewMatch }) {
  const cur = ticketStepCursor(stage, reviewMatch);
  const isRejected = stage === 'rejected';
  const isComplete = stage === 'done';

  function lineClass(i) {
    if (isRejected && i === cur) return 'fail';
    if (isComplete || i <= cur) return 'done';
    return '';
  }

  return (
    <div className="tk-steps">
      {DELIVERY_STEPS.map((label, i) => {
        const isFail = isRejected && i === cur;
        const isDone = i < cur || (isComplete && i === cur);
        const isNow = i === cur && !isRejected && !isComplete;

        return (
          <Fragment key={label}>
            {i > 0 && (
              <span
                className={`tk-step-line${lineClass(i) ? ` ${lineClass(i)}` : ''}`}
                aria-hidden="true"
              />
            )}
            <span className={`tk-step${isDone ? ' done' : ''}${isNow ? ' now' : ''}${isFail ? ' fail' : ''}`}>
              <span className="tk-step-num-wrap">
                <span className="tk-step-num">
                  {isDone ? '✓' : isFail ? '✗' : i + 1}
                </span>
              </span>
              {label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function ReviewVerdictButtons({ busy, onMatch, onMismatch, matchOnly = false }) {
  if (busy) {
    return (
      <div className="tk-verdict-actions" aria-busy="true">
        <Loader2 size={16} strokeWidth={2.25} className="animate-spin text-ams-muted" aria-label="Saving" />
      </div>
    );
  }

  return (
    <div className="tk-verdict-actions" role="group" aria-label="IP review">
      <IconTooltip label="Bound proxy matches screenshot">
        <button
          type="button"
          className="tk-verdict-btn tk-verdict-btn--ok"
          disabled={busy}
          aria-label="Match"
          onClick={onMatch}
        >
          <BadgeCheck size={18} strokeWidth={2} aria-hidden="true" />
          <span>Match</span>
        </button>
      </IconTooltip>
      {!matchOnly && (
        <IconTooltip label="Bound proxy does not match screenshot">
          <button
            type="button"
            className="tk-verdict-btn tk-verdict-btn--bad"
            disabled={busy}
            aria-label="Mismatch"
            onClick={onMismatch}
          >
            <CircleX size={18} strokeWidth={2} aria-hidden="true" />
            <span>Mismatch</span>
          </button>
        </IconTooltip>
      )}
    </div>
  );
}

function DeliveryTicketFormFields({
  siteLabel,
  standby,
  selectedAcct,
  onSelectAccount,
  phoneNumber,
  bindProxy,
  screenshotBase64,
  onScreenshotChange,
  onScreenshotError,
  linkCode,
  onLinkCodeChange,
  rejectReason,
  showAccountPicker = true,
  selectedStaff = '',
}) {
  return (
    <>
      {rejectReason && (
        <p className="drawer-alert drawer-alert--danger">{rejectReason}</p>
      )}

      <p className="drawer-hint drawer-hint--info">
        Select an account — phone and proxy fill in below. Set proxy on PC, upload screenshot,
        enter 6-digit code. Accounts are grouped by Staff (Business assignee).
      </p>

      <div className="drawer-fields">
        {showAccountPicker && standby.length > 0 && (
          <div className="drawer-field">
            <span className="drawer-label">Select account (yours · {siteLabel})</span>
            <StandbyAccountPicker
              accounts={standby}
              value={selectedAcct}
              onChange={onSelectAccount}
            />
            <span className="mt-1 block text-[11px] text-ams-faint">
              Grouped by Staff — search or filter to find the right account.
            </span>
          </div>
        )}

        {selectedStaff && (
          <div className="drawer-locked">
            <span className="drawer-locked-label">Staff</span>
            <span className="drawer-locked-value">{selectedStaff}</span>
          </div>
        )}

        {phoneNumber && (
          <div className="drawer-locked">
            <span className="drawer-locked-label">Phone number</span>
            <span className="drawer-locked-value drawer-locked-value--mono">{phoneNumber}</span>
          </div>
        )}

        {bindProxy && (
          <div className="drawer-field">
            <span className="drawer-label">Proxy to use (must set exactly this on PC)</span>
            <div className="drawer-locked">
              <div className="drawer-proxy-lines">
                <div>IP address: <strong>{bindProxy.ip_address || '—'}</strong></div>
                <div>Port: <strong>{bindProxy.port || '—'}</strong></div>
                <div>Username: <strong>{bindProxy.username || '—'}</strong></div>
                <div>Password: <strong>{bindProxy.password || '—'}</strong></div>
              </div>
            </div>
          </div>
        )}

        <label className="drawer-field">
          <span className="drawer-label">Upload IP setup screenshot</span>
          <ScreenshotUpload
            value={screenshotBase64}
            onChange={onScreenshotChange}
            onError={onScreenshotError}
          />
        </label>

        <label className="drawer-field">
          <span className="drawer-label">
            6-digit code from PC login
            <span className="drawer-label-note">· valid ~8 min after login</span>
          </span>
          <input
            className="input drawer-code-input"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={linkCode}
            onChange={(e) => onLinkCodeChange(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
          />
        </label>
      </div>
    </>
  );
}

function TicketCard({
  ticket, role, canOperatorAct, canBusinessAct, onShot, onGoLive, onReject, onConfirm, onResubmit, onReviewIp, busy,
}) {
  const stage = ticket.delivery_stage;
  const isRejected = stage === 'rejected' || (stage === 'submitted' && ticket.reject_reason);
  const displayStage = isRejected ? 'rejected' : stage;
  const sl = ticketStatusMeta(ticket);
  const attn = ticketBucket(ticket, role) === 'act';
  const bind = ticket.bind_proxy;
  const reviewMatch = ticket.review_match;
  const ticketNo = ticket.ticket_number || ticket.id;

  let reviewCardClass = '';
  if (stage === 'submitted' && !isRejected) {
    if (reviewMatch === true) reviewCardClass = ' tk-card--review-ok';
    else if (reviewMatch === false) reviewCardClass = ' tk-card--review-bad';
    else reviewCardClass = ' tk-card--review-pending';
  }

  const showFoot = stage === 'submitted' && !isRejected;
  const showRejectedFoot = isRejected;
  const showReviewVerdict = stage === 'submitted' && !isRejected;
  const reviewTone = reviewMatch === true ? 'ok' : reviewMatch === false ? 'bad' : 'pending';

  let footActions = null;
  if (canOperatorAct && role === 'operator') {
    if (stage === 'submitted' && reviewMatch === true) {
      footActions = (
        <>
          <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={() => onGoLive(ticket)}>
            <Smartphone size={14} strokeWidth={2.25} />
            Go live
          </button>
          <button type="button" className="btn btn-ghost btn-sm text-ams-danger" disabled={busy} onClick={() => onReject(ticket)}>
            Reject
          </button>
        </>
      );
    } else if (stage === 'submitted' && reviewMatch === false) {
      footActions = (
        <button type="button" className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => onReject(ticket)}>
          Reject
        </button>
      );
    } else if (stage === 'posted') {
      footActions = <span className="tk-foot-note">Waiting for business confirm</span>;
    } else if (isRejected) {
      footActions = (
        <span className="tk-foot-note">Waiting for business to resubmit with corrected screenshot</span>
      );
    }
  } else if (role === 'operator') {
    if (stage === 'posted') {
      footActions = <span className="tk-foot-note">Waiting for business confirm</span>;
    } else if (isRejected) {
      footActions = (
        <span className="tk-foot-note">Waiting for business to resubmit with corrected screenshot</span>
      );
    }
  } else if (canBusinessAct && role === 'business' && isRejected) {
    footActions = (
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onResubmit(ticket)}>
        Resubmit
      </button>
    );
  } else if (canBusinessAct && role === 'business' && stage === 'posted') {
    footActions = (
      <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={() => onConfirm(ticket)}>
        <CheckCircle2 size={14} strokeWidth={2.25} />
        Confirm live
      </button>
    );
  }

  const siteChip = getSiteChipClass(ticket.site_key);
  const hubOwner = (ticket.owner || ticket.customer_name || '').trim();
  const staffName = (ticket.staff || '').trim();
  const accountLabel = ticket.account_name || '—';
  const headline = role === 'operator' && hubOwner ? hubOwner : accountLabel;

  return (
    <article className={`card tk-card${attn ? ' tk-card--attn' : ''}${reviewCardClass}${isRejected ? ' tk-card--rejected' : ''}`}>
      <div className="tk-head">
        <div className="tk-head-body">
          <div className="tk-head-row">
            <h3 className="tk-acct">{headline}</h3>
            <span className="tk-tid">#{ticketNo}</span>
            <span className={siteChip}>{SITES[ticket.site_key]?.short || ticket.site_key}</span>
          </div>
          {role === 'business' && (
            <p className="tk-staff-line">
              {staffName ? `Staff · ${staffName}` : 'Staff · Unassigned'}
            </p>
          )}
          {role === 'operator' && hubOwner && accountLabel && accountLabel !== '—' && (
            <p className="tk-staff-line">{accountLabel}</p>
          )}
        </div>
        <div className="tk-head-badges">
          <span className={`tk-status-pill ${sl.pill}`}>{sl.label}</span>
        </div>
      </div>

      <div className="tk-body">
        <DeliverySteps stage={displayStage} reviewMatch={reviewMatch} />

        {isRejected && (
          <div className="tk-banner tk-banner--bad">
            Rejected — {ticket.reject_reason || 'IP mismatch'}
          </div>
        )}
        {stage === 'posted' && (
          <div className="tk-banner tk-banner--wait">
            <Loader2 size={14} strokeWidth={2.25} className="shrink-0 animate-spin" />
            Awaiting business confirmation
          </div>
        )}
        {stage === 'done' && (
          <div className="tk-banner tk-banner--ok">
            <CheckCircle2 size={14} strokeWidth={2.25} className="shrink-0" aria-hidden="true" />
            Both sides confirmed — delivery complete
          </div>
        )}

        {showReviewVerdict && (
          <IpReviewVerdict reviewMatch={reviewMatch} />
        )}

        <TicketDetailsBlock ticket={ticket} bind={bind} />
      </div>

      {(showFoot || showRejectedFoot || footActions) && (
        <div className={`tk-foot${showFoot ? ` tk-foot--${reviewTone}` : ''}`}>
          {showFoot && (
            <div className="tk-foot-review">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShot(ticket)}>
                View business screenshot
              </button>
              {ticket.link_code && (
                <span className="tk-code-pill" title="6-digit link code">{ticket.link_code}</span>
              )}
            </div>
          )}
          <div className="tk-foot-actions">
            {showFoot && canOperatorAct && role === 'operator' && reviewMatch == null && (
              <ReviewVerdictButtons
                busy={busy}
                onMatch={() => onReviewIp(ticket, true)}
                onMismatch={() => onReviewIp(ticket, false)}
              />
            )}
            {showFoot && canOperatorAct && role === 'operator' && reviewMatch === false && (
              <ReviewVerdictButtons
                busy={busy}
                matchOnly
                onMatch={() => onReviewIp(ticket, true)}
                onMismatch={() => onReviewIp(ticket, false)}
              />
            )}
            {footActions}
          </div>
        </div>
      )}
    </article>
  );
}

export default function TicketsPage() {
  const { site } = useSite();
  const { profile } = useAuth();
  const canOperatorAct = profile?.role === 'operator' || profile?.role === 'admin';
  const canBusinessAct = profile?.role === 'business' || profile?.role === 'admin';
  const isAdminUser = profile?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerFilter = (searchParams.get('owner') || '').trim();
  const [role, setRole] = useState('business');
  const [groupTab, setGroupTab] = useState('act');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [shotTicket, setShotTicket] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [rejectTicket, setRejectTicket] = useState(null);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [rejectReasonOther, setRejectReasonOther] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [selectedAcct, setSelectedAcct] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [screenshotBase64, setScreenshotBase64] = useState('');
  const [resubmitTicket, setResubmitTicket] = useState(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: tickets = [], isLoading } = useTickets(site);
  const { data: available = [], isLoading: loadingStandby } = useStandbyForTickets(site);
  const { create, goLive, reject, resubmit, confirm, reviewIp } = useTicketMutations();

  const standby = available;

  const filteredTickets = useMemo(() => {
    let rows = tickets;
    if (ownerFilter) {
      rows = rows.filter((t) => {
        const owner = (t.owner || t.customer_name || '').trim();
        return owner === ownerFilter;
      });
    }
    const q = search.trim();
    if (!q) return rows;
    return rows.filter((t) => ticketMatchesSearch(t, q));
  }, [tickets, search, ownerFilter]);

  const grouped = useMemo(() => {
    const map = { act: [], prog: [], completed: [], history: [] };
    filteredTickets.forEach((t) => {
      const bucket = ticketBucket(t, role === 'business' ? 'business' : 'operator');
      map[bucket].push(t);
    });
    return map;
  }, [filteredTickets, role]);

  const tabItems = grouped[groupTab] || [];
  const totalPages = Math.max(1, Math.ceil(tabItems.length / TICKETS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = tabItems.slice(
    (safePage - 1) * TICKETS_PAGE_SIZE,
    safePage * TICKETS_PAGE_SIZE,
  );
  const pageStart = tabItems.length ? (safePage - 1) * TICKETS_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(safePage * TICKETS_PAGE_SIZE, tabItems.length);

  const actCount = grouped.act.length;
  const progCount = grouped.prog.length;

  useEffect(() => {
    if (!profile?.role) return;
    if (profile.role === 'operator' || profile.role === 'admin') setRole('operator');
    else if (profile.role === 'business') setRole('business');
  }, [profile?.role]);

  useEffect(() => {
    setGroupTab('act');
  }, [role]);

  useEffect(() => {
    setPage(1);
  }, [search, groupTab, role, site]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!shotTicket) setLightboxUrl(null);
  }, [shotTicket]);

  function showToast(msg) {
    setToast(msg);
  }

  function pickAccount(id) {
    setSelectedAcct(id);
  }

  function openNewDrawer() {
    const first = standby[0];
    setSelectedAcct(first?.id || '');
    if (first) pickAccount(first.id);
    setLinkCode('');
    setScreenshotBase64('');
    setNewOpen(true);
  }

  async function submitNew(e) {
    e.preventDefault();
    if (!selectedAcct || !/^\d{6}$/.test(linkCode)) {
      showToast('Select an account and enter a 6-digit link code');
      return;
    }
    if (!screenshotBase64) {
      showToast('Upload your IP setup screenshot');
      return;
    }
    const bind = selectedRow?.bind_proxy;
    if (!bind?.ip_address || !bind?.port) {
      showToast('Selected account has no bound proxy');
      return;
    }
    setBusy(true);
    try {
      const created = await create.mutateAsync({
        account_id: selectedAcct,
        link_code: linkCode,
        shot_proxy: bind,
        screenshot_base64: screenshotBase64,
      });
      setNewOpen(false);
      setLinkCode('');
      setScreenshotBase64('');
      if (role === 'business') {
        setGroupTab('prog');
        setPage(1);
      }
      showToast(`Delivery ticket #${created.ticket_number || created.id} submitted — operator will review IP screenshot`);
    } catch (err) {
      showToast(err.message || 'Submit failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewIp(ticket, match) {
    setBusy(true);
    try {
      await reviewIp.mutateAsync({ id: ticket.id, match });
      showToast(match
        ? `IP marked as match for #${ticket.ticket_number || ticket.id}`
        : `IP marked as mismatch for #${ticket.ticket_number || ticket.id}`);
      return true;
    } catch (err) {
      showToast(err.message || 'Review failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleGoLive(ticket) {
    setBusy(true);
    try {
      await goLive.mutateAsync(ticket.id);
      showToast(`Go-live approved for #${ticket.ticket_number || ticket.id}. Enter 6-digit code on phone.`);
    } catch (err) {
      showToast(err.message || 'Go-live failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectSubmit() {
    if (!rejectTicket) return;
    const reason = rejectReason === REJECT_REASON_OTHER
      ? rejectReasonOther.trim()
      : rejectReason;
    if (!reason) {
      showToast(rejectReason === REJECT_REASON_OTHER
        ? 'Enter a reason for rejection'
        : 'Select a rejection reason');
      return;
    }
    setBusy(true);
    try {
      await reject.mutateAsync({ id: rejectTicket.id, reason });
      setRejectTicket(null);
      setRejectReasonOther('');
      showToast(`Ticket rejected — business must resubmit with corrected proxy screenshot`);
    } catch (err) {
      showToast(err.message || 'Reject failed');
    } finally {
      setBusy(false);
    }
  }

  function closeRejectDialog() {
    setRejectTicket(null);
    setRejectReasonOther('');
  }

  function openRejectDialog(ticket) {
    if (ticket.review_match === false) {
      setRejectReason(REJECT_REASONS[0]);
    }
    setRejectReasonOther('');
    setRejectTicket(ticket);
  }

  async function handleConfirm(ticket) {
    setBusy(true);
    try {
      await confirm.mutateAsync(ticket.id);
      showToast(`Delivery complete for #${ticket.ticket_number || ticket.id}`);
    } catch (err) {
      showToast(err.message || 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleResubmitSubmit(e) {
    e.preventDefault();
    if (!resubmitTicket || !/^\d{6}$/.test(linkCode)) return;
    if (!screenshotBase64) {
      showToast('Upload your updated IP setup screenshot');
      return;
    }
    const bind = resubmitTicket?.bind_proxy;
    if (!bind?.ip_address || !bind?.port) {
      showToast('Ticket has no bound proxy');
      return;
    }
    setBusy(true);
    try {
      await resubmit.mutateAsync({
        id: resubmitTicket.id,
        link_code: linkCode,
        shot_proxy: bind,
        screenshot_base64: screenshotBase64,
      });
      setResubmitTicket(null);
      setScreenshotBase64('');
      showToast('Ticket resubmitted for operator review');
    } catch (err) {
      showToast(err.message || 'Resubmit failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedRow = standby.find((a) => a.id === selectedAcct);
  const bindForSelected = selectedRow?.bind_proxy || null;
  const siteLabel = site === 'all' ? 'All sites' : (SITES[site]?.name || site);
  const phoneForSelected = selectedRow?.phone_number || selectedRow?.sim || '';

  return (
    <div>
      <PageHead
        title="Business Self-Service Delivery"
        description="Submit go-live requests, review IP screenshots against bound proxy, and confirm delivery when both sides are ready."
        actions={!isLoading && tickets.length > 0 ? (
          <div className="page-meta-bubble">
            {actCount > 0 && (
              <>
                <span className="font-semibold text-ams-warn">{actCount}</span>
                <span>need action</span>
              </>
            )}
            {actCount > 0 && progCount > 0 && <span className="text-ams-faint">·</span>}
            {progCount > 0 && (
              <>
                <span className="font-semibold text-ams-blue">{progCount}</span>
                <span>in progress</span>
              </>
            )}
          </div>
        ) : null}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {isAdminUser ? (
          <SegControl
            value={role}
            onChange={setRole}
            size="sm"
            options={[
              { value: 'business', label: 'Business' },
              { value: 'operator', label: 'Operator' },
            ]}
          />
        ) : (
          <span className="badge badge-default">
            {profile?.role === 'operator' ? 'Operator' : 'Business'}
          </span>
        )}
        {ownerFilter && (
          <button
            type="button"
            className="badge badge-accent"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('owner');
              setSearchParams(next, { replace: true });
            }}
          >
            Staff: {ownerFilter} ×
          </button>
        )}
        <p className="text-xs text-ams-muted">
          {isAdminUser
            ? 'Admin: tab Operator untuk review IP · tab Business untuk confirm delivery.'
            : role === 'business'
              ? 'Submit tickets and confirm when the account is live.'
              : 'Review IP match, go live on phone, or reject mismatches.'}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ams-line border-t-ams-accent" role="status" aria-label="Loading tickets" />
        </div>
      )}

      {!isLoading && (
        <div className="tk-tab-toolbar">
          <div className="page-tab-bar tk-tab-toolbar-tabs" role="tablist" aria-label="Ticket groups">
            {GROUPS.map(({ key, tabLabel }) => {
              const count = grouped[key].length;
              const active = groupTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? 'page-tab page-tab-active' : 'page-tab'}
                  onClick={() => setGroupTab(key)}
                >
                  {tabLabel}
                  <span className={`page-tab-badge${key === 'act' && count > 0 ? ' page-tab-badge--warn' : ''}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="tk-tab-toolbar-actions">
            {tickets.length > 0 && (
              <div className="tk-search">
                <Search size={15} className="tk-search-icon" strokeWidth={2} />
                <input
                  className="input tk-search-input"
                  type="search"
                  placeholder="Ticket #, account, device, phone"
                  aria-label="Search tickets by number, account, device ID, or phone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            {canBusinessAct && role === 'business' && (
              <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={openNewDrawer}>
                <Plus size={15} strokeWidth={2} />
                New delivery ticket
              </button>
            )}
          </div>
        </div>
      )}

      {!isLoading && (
        <>
          {filteredTickets.length === 0 && search.trim() ? (
            <div className="empty-hint">No tickets match your search.</div>
          ) : tabItems.length === 0 ? (
            <div className="empty-hint">
              {tickets.length === 0
                ? 'No delivery tickets for this site.'
                : groupTab === 'completed'
                  ? 'No completed delivery tickets yet.'
                  : groupTab === 'history'
                    ? 'No rejected tickets in history.'
                    : 'No tickets in this group.'}
            </div>
          ) : (
            <>
          <section className="mb-8">
              <div className="tkgroup-body">
                {pageItems.map((t) => (
                  <TicketCard
                    key={t.id}
                    ticket={t}
                    role={role === 'business' ? 'business' : 'operator'}
                    canOperatorAct={canOperatorAct}
                    canBusinessAct={canBusinessAct}
                    busy={busy}
                    onShot={setShotTicket}
                    onGoLive={handleGoLive}
                    onReject={openRejectDialog}
                    onConfirm={handleConfirm}
                    onResubmit={(tk) => {
                      setResubmitTicket(tk);
                      setLinkCode(tk.link_code || '');
                      setScreenshotBase64('');
                    }}
                    onReviewIp={handleReviewIp}
                  />
                ))}
              </div>
              {tabItems.length > TICKETS_PAGE_SIZE && (
                <div className="tk-pager">
                  <p className="tk-pager-meta">
                    Showing {pageStart}–{pageEnd} of {tabItems.length}
                  </p>
                  <div className="tk-pager-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={safePage <= 1}
                      onClick={() => setPage(safePage - 1)}
                    >
                      Previous
                    </button>
                    <span className="tk-pager-page">
                      Page {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage(safePage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
          </section>
            </>
          )}
        </>
      )}

      <DetailDialog
        open={!!shotTicket}
        title={`Screenshot review · #${shotTicket?.ticket_number || shotTicket?.id || ''}`}
        cardClassName="detail-card--shot"
        onClose={() => setShotTicket(null)}
        footer={
          role === 'operator'
          && shotTicket?.delivery_stage === 'submitted'
          && shotTicket?.review_match == null ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <ReviewVerdictButtons
                busy={busy}
                onMatch={async () => {
                  if (await handleReviewIp(shotTicket, true)) setShotTicket(null);
                }}
                onMismatch={async () => {
                  if (await handleReviewIp(shotTicket, false)) setShotTicket(null);
                }}
              />
            </div>
          ) : null
        }
      >
        {shotTicket && (
          <ScreenshotReviewPanel
            ticket={shotTicket}
            onEnlarge={() => setLightboxUrl(shotTicket.screenshot_url)}
          />
        )}
      </DetailDialog>

      <ImageLightbox
        src={lightboxUrl}
        alt="Business IP setup screenshot"
        onClose={() => setLightboxUrl(null)}
      />

      <DetailDialog
        open={!!rejectTicket}
        title={`Reject ticket · #${rejectTicket?.ticket_number || rejectTicket?.id || ''}`}
        onClose={closeRejectDialog}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeRejectDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy || (rejectReason === REJECT_REASON_OTHER && !rejectReasonOther.trim())}
              onClick={handleRejectSubmit}
            >
              Reject ticket
            </button>
          </>
        )}
      >
        <div className="drawer-fields">
          <label className="drawer-field">
            <span className="drawer-label">Reason</span>
            <select className="input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
              {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {rejectReason === REJECT_REASON_OTHER && (
            <label className="drawer-field">
              <span className="drawer-label">Specify reason</span>
              <textarea
                className="input min-h-[5rem] resize-y"
                value={rejectReasonOther}
                onChange={(e) => setRejectReasonOther(e.target.value)}
                placeholder="Describe why this ticket is rejected"
                maxLength={500}
                autoFocus
              />
            </label>
          )}
        </div>
      </DetailDialog>

      <Drawer
        open={newOpen}
        size="ticket"
        title="Pick account & submit go-live ticket"
        onClose={() => {
          setNewOpen(false);
          setScreenshotBase64('');
        }}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setNewOpen(false)}>Cancel</button>
            <button
              type="submit"
              form="new-delivery-ticket-form"
              className="btn btn-primary"
              disabled={busy || !standby.length}
            >
              Submit ticket
            </button>
          </>
        )}
      >
        {loadingStandby ? (
          <div className="drawer-empty-state flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-ams-line border-t-ams-accent" role="status" aria-label="Loading accounts" />
            <span className="text-sm text-ams-muted">Loading standby accounts…</span>
          </div>
        ) : !standby.length ? (
          <div className="drawer-empty-state">
            <p className="drawer-hint drawer-hint--center">
              No standby accounts available for this site.
              {site !== 'all' ? ' Try switching site to All in the top bar.' : ''}
            </p>
          </div>
        ) : (
          <form id="new-delivery-ticket-form" onSubmit={submitNew} className="drawer-form drawer-form--ticket">
            <DeliveryTicketFormFields
              siteLabel={siteLabel}
              standby={standby}
              selectedAcct={selectedAcct}
              onSelectAccount={pickAccount}
              phoneNumber={phoneForSelected}
              bindProxy={bindForSelected}
              screenshotBase64={screenshotBase64}
              onScreenshotChange={setScreenshotBase64}
              onScreenshotError={showToast}
              linkCode={linkCode}
              onLinkCodeChange={setLinkCode}
              selectedStaff={(selectedRow?.staff || '').trim()}
            />
          </form>
        )}
      </Drawer>

      <Drawer
        open={!!resubmitTicket}
        size="ticket"
        title={`Resubmit · #${resubmitTicket?.ticket_number || resubmitTicket?.id || ''}`}
        onClose={() => {
          setResubmitTicket(null);
          setScreenshotBase64('');
        }}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setResubmitTicket(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleResubmitSubmit}>
              Resubmit ticket
            </button>
          </>
        )}
      >
        <form onSubmit={handleResubmitSubmit} className="drawer-form drawer-form--ticket">
          <DeliveryTicketFormFields
            siteLabel={siteLabel}
            standby={[]}
            selectedAcct=""
            onSelectAccount={() => {}}
            phoneNumber={resubmitTicket?.phone_number}
            bindProxy={resubmitTicket?.bind_proxy}
            screenshotBase64={screenshotBase64}
            onScreenshotChange={setScreenshotBase64}
            onScreenshotError={showToast}
            linkCode={linkCode}
            onLinkCodeChange={setLinkCode}
            rejectReason={resubmitTicket?.reject_reason}
            showAccountPicker={false}
            selectedStaff={(resubmitTicket?.staff || '').trim()}
          />
        </form>
      </Drawer>

      <Toast open={!!toast} message={toast} onClose={() => setToast('')} />
    </div>
  );
}
