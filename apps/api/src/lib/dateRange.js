/** Parse governance date-range query params (YYYY-MM-DD). */

function parseDay(value, endOfDay = false) {
  if (!value || typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function parseDateRangeQuery(query = {}) {
  const fromRaw = query.from || query.date_from;
  const toRaw = query.to || query.date_to;
  if (!fromRaw && !toRaw) return null;

  const start = parseDay(fromRaw, false);
  const end = parseDay(toRaw, true) || parseDay(fromRaw, true);
  if (!start && !end) return null;

  return {
    start,
    end: end || start,
    from: fromRaw || toRaw,
    to: toRaw || fromRaw,
  };
}

export function inDateRange(iso, range) {
  if (!range || !iso) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (range.start && t < range.start.getTime()) return false;
  if (range.end && t > range.end.getTime()) return false;
  return true;
}

export function rangeEvalAt(range) {
  if (!range?.end) return new Date();
  const now = new Date();
  return range.end.getTime() < now.getTime() ? range.end : now;
}

export function isRangeEndingToday(range) {
  if (!range?.end) return true;
  const now = new Date();
  return (
    range.end.getFullYear() === now.getFullYear()
    && range.end.getMonth() === now.getMonth()
    && range.end.getDate() === now.getDate()
  );
}
