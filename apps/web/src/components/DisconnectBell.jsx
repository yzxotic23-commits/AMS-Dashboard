import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import { useAllAccounts } from '../hooks/useOperatorAccounts';

/** Header bell for pending business disconnect reports (operator/admin only). */
export default function DisconnectBell() {
  const { profile } = useAuth();
  const { site } = useSite();
  const navigate = useNavigate();
  const canSee = profile?.role === 'admin' || profile?.role === 'operator';
  const { data: accounts = [] } = useAllAccounts({ enabled: canSee });
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const pending = useMemo(() => {
    if (!canSee) return [];
    return accounts
      .filter((a) => a.disconnect_report)
      .filter((a) => site === 'all' || a.siteKey === site || a.siteKey === 'all')
      .sort((a, b) => {
        const ta = new Date(a.disconnect_report?.reported_at || 0).getTime();
        const tb = new Date(b.disconnect_report?.reported_at || 0).getTime();
        return tb - ta;
      });
  }, [accounts, canSee, site]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canSee) return null;

  const count = pending.length;

  function openReport(id) {
    setOpen(false);
    navigate(`/accounts?open=${encodeURIComponent(id)}`);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="header-bell-btn"
        aria-label={count ? `${count} disconnect reports` : 'No disconnect reports'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} strokeWidth={1.75} />
        {count > 0 && <span className="header-bell-dot" aria-hidden />}
      </button>

      {open && (
        <div className="header-bell-panel" role="menu">
          <div className="border-b border-ams-line px-3 py-2.5">
            <p className="text-[13px] font-semibold text-ams-ink">Disconnect reports</p>
            <p className="text-[11px] text-ams-faint">
              {count ? `${count} awaiting R&M review` : 'Nothing pending'}
            </p>
          </div>
          {count === 0 ? (
            <p className="px-3 py-4 text-[13px] text-ams-muted">No reports from business right now.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {pending.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="header-bell-item"
                    onClick={() => openReport(a.id)}
                  >
                    <span className="font-semibold text-ams-ink">{a.account_name}</span>
                    <span className="mt-0.5 block text-[11px] text-ams-muted">
                      {a.disconnect_report.reported_by || a.staff || 'Business'}
                      {' · '}
                      {new Date(a.disconnect_report.reported_at).toLocaleString()}
                    </span>
                    {a.disconnect_report.note ? (
                      <span className="mt-0.5 block truncate text-[11px] text-ams-faint">
                        {a.disconnect_report.note}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-ams-line px-3 py-2">
            <button
              type="button"
              className="text-[12px] font-medium text-ams-accent hover:underline"
              onClick={() => {
                setOpen(false);
                navigate('/accounts');
              }}
            >
              Open Resource Ledger
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
