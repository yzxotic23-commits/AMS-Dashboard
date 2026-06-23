/** Resolve hub owner from account metadata or registration log only — no dummy defaults. */
export function resolveHubOwner(_account, opMeta = {}, regOwner = '') {
  const metaOwner = String(opMeta?.owner || '').trim();
  if (metaOwner) return metaOwner;
  return String(regOwner || '').trim();
}
