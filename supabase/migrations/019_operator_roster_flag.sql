-- Admins who also register and own accounts (e.g. ORM team) must stay in the pipeline
-- operator roster (Owner dropdown, per-operator counts). Operators are always included.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS in_operator_roster BOOLEAN NOT NULL DEFAULT false;

-- Bryan (Malaysia) was promoted to admin but still registers accounts.
UPDATE profiles SET in_operator_roster = true WHERE username = 'rm-exec-1-my';
