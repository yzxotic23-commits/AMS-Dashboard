function allowedExportUsernames() {
  return (process.env.EXPORT_ALLOWED_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Exports are admin-only; EXPORT_ALLOWED_USERNAMES narrows that to named admins. */
export function canExport(profile) {
  if (profile?.role !== 'admin') return false;
  const allowed = allowedExportUsernames();
  return allowed.length === 0 || allowed.includes(String(profile.username || '').toLowerCase());
}

export function requireExport(req, res, next) {
  if (!canExport(req.profile)) {
    return res.status(403).json({ error: 'You do not have export permission', code: 'EXPORT_NOT_ALLOWED' });
  }
  next();
}
