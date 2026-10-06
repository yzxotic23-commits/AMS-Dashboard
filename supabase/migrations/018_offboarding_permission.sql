-- Resource team (ORM) can lock/unlock non-admin AMS accounts when an offboarding request
-- comes in, without holding full admin rights. Admins grant it per user.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_offboard BOOLEAN NOT NULL DEFAULT false;

-- Bryan (Malaysia) and Seavmey (Cambodia) own day-to-day offboarding.
UPDATE profiles SET can_offboard = true WHERE username IN ('rm-exec-1-my', 'rm-exec-2-cam');
