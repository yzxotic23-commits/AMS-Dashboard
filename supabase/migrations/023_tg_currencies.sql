-- Telegram OTP: GCS access is granted per currency (MYR / SGD / USC), covering every GCS brand
-- in that currency. Existing per-brand grants are converted to their currencies.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tg_currencies TEXT[] NOT NULL DEFAULT '{}';

UPDATE profiles p
SET tg_currencies = sub.currencies
FROM (
  SELECT pr.id, array_agg(DISTINCT upper(a.currency) ORDER BY upper(a.currency)) AS currencies
  FROM profiles pr
  JOIN tg_accounts a
    ON a.pool = 'gcs'
   AND a.currency IS NOT NULL
   AND upper(a.brand) = ANY (pr.tg_brands)
  GROUP BY pr.id
) sub
WHERE p.id = sub.id
  AND p.tg_currencies = '{}';
