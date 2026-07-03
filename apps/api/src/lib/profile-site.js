import pg from 'pg';

export function normalizeSiteKey(role, siteKey) {
  const sk = siteKey === 'my' || siteKey === 'pp' || siteKey === 'all' ? siteKey : null;
  if (role === 'admin') return sk || 'all';
  if (sk === 'all') return 'all';
  return sk === 'pp' ? 'pp' : 'my';
}

export function pgConfig() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes('YOUR-PASSWORD')) return null;
  return { connectionString: dbUrl, ssl: { rejectUnauthorized: false } };
}

export async function withPg(fn) {
  const config = pgConfig();
  if (!config) return null;
  const client = new pg.Client(config);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function fetchSiteKeysByIds(client, ids) {
  if (!ids.length) return {};
  const { rows } = await client.query(
    'SELECT id, site_key FROM profiles WHERE id = ANY($1::uuid[])',
    [ids],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.site_key]));
}

export async function enrichProfilesSiteKey(rows) {
  if (!rows?.length) return rows || [];
  const siteMap = await withPg((client) => fetchSiteKeysByIds(client, rows.map((r) => r.id)));
  if (!siteMap) {
    return rows.map((u) => ({
      ...u,
      site_key: normalizeSiteKey(u.role, u.site_key),
    }));
  }
  return rows.map((u) => ({
    ...u,
    site_key: normalizeSiteKey(u.role, siteMap[u.id] ?? u.site_key),
  }));
}

export async function enrichProfileSiteKey(profile) {
  if (!profile?.id) return profile;
  const siteMap = await withPg((client) => fetchSiteKeysByIds(client, [profile.id]));
  const raw = siteMap?.[profile.id] ?? profile.site_key;
  return { ...profile, site_key: normalizeSiteKey(profile.role, raw) };
}
