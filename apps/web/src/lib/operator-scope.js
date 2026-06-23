export function isAdminProfile(profile) {
  return profile?.role === 'admin';
}

/** Site filter locked for operators; admin may use all/my/pp. */
export function operatorSiteKey(profile) {
  if (isAdminProfile(profile)) {
    const sk = profile?.site_key;
    if (sk === 'my' || sk === 'pp') return sk;
    return 'all';
  }
  return profile?.site_key === 'pp' ? 'pp' : 'my';
}

export function siteOptionsForProfile(profile) {
  if (isAdminProfile(profile)) return ['all', 'my', 'pp'];
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
