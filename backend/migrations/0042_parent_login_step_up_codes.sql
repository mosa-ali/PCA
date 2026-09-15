-- Owner authentication-architecture decision (2026-09-15): normal
-- parent/family users authenticate with email + password, with a
-- short-lived, single-use, hash-only-at-rest email one-time code required
-- at specific risk-triggering moments -- NOT Platform Admin-style TOTP on
-- every login. This migration implements the first, narrowest, unambiguous
-- risk trigger the owner's own list names: "first successful login."
-- Broader device/session-risk recognition remains a documented future
-- enhancement (see ParentAccountService.ts's own doc comment on this
-- feature) -- adding it later needs no further schema change here, since
-- the trigger decision lives in application code, not in this table.
--
-- Deliberately a SEPARATE table from parent_email_verification_codes
-- (migration 0013) and parent_password_reset_codes (migration 0029), same
-- reasoning as 0029's own header: these three code kinds protect three
-- different actions, and mixing them into one table would make a stale
-- code from one purpose replayable against another. Identical
-- single-use/TTL-bounded/attempt-counted shape as its two siblings.
CREATE TABLE parent_login_step_up_codes (
  code_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (code_id),
  KEY parent_login_step_up_codes_account_idx (account_id, created_at),
  CONSTRAINT parent_login_step_up_codes_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id)
) ENGINE=InnoDB;

-- NULL = this account has never completed a login step-up yet (its NEXT
-- successful password check requires one); non-NULL = it has, and
-- routine subsequent logins proceed without one. Deliberately distinct
-- from `verified_at` (email-verified at registration time is not the same
-- fact as "has completed at least one step-up-verified login").
ALTER TABLE parent_accounts
  ADD COLUMN first_login_completed_at DATETIME(3) NULL AFTER verified_at;
