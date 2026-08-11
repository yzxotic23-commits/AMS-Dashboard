export function isAdminProfile(profile) {
  return profile?.role === 'admin';
}

/** Site filter: admin and all-site operators may use all/my/pp; others locked to assigned site. */
export function operatorSiteKey(profile) {
  const sk = profile?.site_key;
  // Business is scoped by brand (server-side), not site — never lock their site switcher.
  if (isAdminProfile(profile) || profile?.role === 'business') {
    if (sk === 'my' || sk === 'pp') return sk;
    return 'all';
  }
  if (sk === 'pp' || sk === 'my' || sk === 'all') return sk;
  return 'my';
}

export function siteOptionsForProfile(profile) {
  if (isAdminProfile(profile) || profile?.role === 'business') return ['all', 'my', 'pp'];
  if (profile?.site_key === 'all') return ['all', 'my', 'pp'];
  return [operatorSiteKey(profile)];
}

export function operatorDisplayLabel(profile) {
  return String(profile?.full_name || profile?.username || '').trim();
}

function rosterDisplayName(row) {
  return String(row?.full_name || row?.username || '').trim();
}

export function filterRosterForProfile(roster, profile) {
  if (!profile || isAdminProfile(profile)) return roster || [];
  const selfId = profile.id;
  const selfName = operatorDisplayLabel(profile);
  return (roster || []).filter((op) => {
    if (selfId && op.id === selfId) return true;
    return rosterDisplayName(op) === selfName;
  });
}
