/** Governance dashboard date-range presets and formatting. */

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function toDateInputValue(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateInputValue(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function presetRange(preset) {
  const today = startOfDay(new Date());
  if (preset === 'today') {
    return { from: today, to: endOfDay(today) };
  }
  if (preset === '7d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from, to: endOfDay(today) };
  }
  if (preset === '30d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from, to: endOfDay(today) };
  }
  return null;
}

export function defaultGovernanceRange() {
  return { preset: '30d', ...presetRange('30d') };
}

export function formatDateChip(d) {
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatRangeShort(from, to) {
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  const a = from.toLocaleDateString('en-GB', opts);
  const b = to.toLocaleDateString('en-GB', opts);
  if (a === b) return a;
  const sameYear = from.getFullYear() === to.getFullYear();
  const aShort = from.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const bShort = to.toLocaleDateString('en-GB', opts);
  return `${aShort} – ${bShort}`;
}

export function formatRangeCompact(from, to) {
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  if (sameMonth && from.getDate() === to.getDate()) {
    return from.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (sameMonth) {
    const mon = from.toLocaleDateString('en-GB', { month: 'short' });
    return `${String(from.getDate()).padStart(2, '0')}–${String(to.getDate()).padStart(2, '0')} ${mon} ${from.getFullYear()}`;
  }
  return formatRangeShort(from, to);
}

export function isRangeEndingToday(to) {
  const now = new Date();
  return (
    to.getFullYear() === now.getFullYear()
    && to.getMonth() === now.getMonth()
    && to.getDate() === now.getDate()
  );
}

export function apiDateParams(from, to) {
  return {
    from: toDateInputValue(from),
    to: toDateInputValue(to),
  };
}
