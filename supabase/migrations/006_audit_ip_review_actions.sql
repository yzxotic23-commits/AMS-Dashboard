-- IP review match/mismatch audit actions (operator screenshot review)
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'IP_REVIEW_MATCH';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'IP_REVIEW_MISMATCH';
