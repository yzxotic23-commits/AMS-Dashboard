import { BRAND_OPTIONS } from './account-status-labels';

export { BRAND_OPTIONS };

export function normalizeBrands(input) {
  const allowed = new Set(BRAND_OPTIONS);
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const brand = String(raw || '').trim().toUpperCase();
    if (!brand || !allowed.has(brand) || seen.has(brand)) continue;
    seen.add(brand);
    out.push(brand);
  }
  return out;
}

export function brandsLabel(brands) {
  const list = normalizeBrands(brands);
  return list.length ? list.join(', ') : '—';
}
