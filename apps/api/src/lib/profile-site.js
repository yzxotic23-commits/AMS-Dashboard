import pg from 'pg';
import { normalizeBrands } from './accountBrand.js';

export function normalizeSiteKey(role, siteKey) {
  if (siteKey === 'my' || siteKey === 'pp' || siteKey === 'all') return siteKey;
  return role === 'admin' ? 'all' : 'my';
}

export function normalizeProfileBrands(role, brands) {
  const list = normalizeBrands(brands);
  if (role === 'business') return list;
  return list;
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
  return rows.map((u) => ({
    ...u,
    site_key: normalizeSiteKey(u.role, u.site_key),
    brands: normalizeProfileBrands(u.role, u.brands),
  }));
}

export async function enrichProfileSiteKey(profile) {
  if (!profile?.id) return profile;
  return {
    ...profile,
    site_key: normalizeSiteKey(profile.role, profile.site_key),
    brands: normalizeProfileBrands(profile.role, profile.brands),
  };
}
