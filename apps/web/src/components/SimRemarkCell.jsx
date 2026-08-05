import { useEffect, useRef, useState } from 'react';

function formatRemarkMeta(updatedAt, updatedBy) {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return updatedBy || null;
  const when = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return updatedBy ? `${updatedBy} · ${when}` : when;
}

export default function SimRemarkCell({
  remark,
  updatedAt,
  updatedBy,
  phone,
  busy,
  onSave,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(remark || '');
  const inputRef = useRef(null);
  const skipBlurCommit = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(remark || '');
  }, [remark, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    if (skipBlurCommit.current) {
      skipBlurCommit.current = false;
      return;
    }
    const next = draft.trim();
    const prev = (remark || '').trim();
    setEditing(false);
    if (next === prev) return;
    onSave?.(next || null);
  }

  function cancel() {
    skipBlurCommit.current = true;
    setDraft(remark || '');
    setEditing(false);
  }

  const meta = formatRemarkMeta(updatedAt, updatedBy);

  if (editing) {
    return (
      <td className="col-remark col-remark--edit">
        <textarea
          ref={inputRef}
          className="sim-remark-input"
          rows={2}
          value={draft}
          disabled={busy}
          aria-label={`Remark for ${phone}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
        />
      </td>
    );
  }

  return (
    <td className="col-remark">
      <button
        type="button"
        className="sim-remark-trigger"
        disabled={busy}
        onClick={() => setEditing(true)}
        title="Click to edit remark"
      >
        {remark ? (
          <span className="sim-remark-text">{remark}</span>
        ) : (
          <span className="text-[12.5px] text-ams-faint">—</span>
        )}
        {meta && <span className="sim-remark-meta">{meta}</span>}
      </button>
    </td>
  );
}
