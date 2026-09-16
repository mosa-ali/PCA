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
-- IF NOT EXISTS / IF EXISTS on both statements below (PCA-DW-W3-E,
-- 2026-09-16): this file has two DDL statements, and MySQL DDL
-- auto-commits per statement (not as one transaction, per
-- scripts/migrate.mjs's own header) -- so a process interrupted between
-- them would otherwise leave the table created but the column missing,
-- and a naive retry would then fail with "table already exists" before
-- ever reaching the ALTER. Making both statements safely re-runnable
-- closes that gap without changing the intended final schema: a fresh
-- run creates both exactly as before; a resumed run after a partial
-- failure skips whatever already succeeded and completes the rest;
-- scripts/migrate.mjs still only records this file as applied in
-- schema_migrations after the WHOLE file (both statements) succeeds.
CREATE TABLE IF NOT EXISTS parent_login_step_up_codes (
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
-- MySQL has no `ADD COLUMN IF NOT EXISTS` (that's a MariaDB-only extension
-- -- confirmed by testing: MySQL 8.4 raises ER_PARSE_ERROR on it). This is
-- the standard MySQL idiom for a conditional ALTER: build the statement
-- text only if the column is genuinely absent, then PREPARE/EXECUTE it; if
-- it already exists, the prepared statement is an inert `SELECT 1` instead.
SET @pca_0042_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts' AND column_name = 'first_login_completed_at'
);
SET @pca_0042_alter_sql = IF(
  @pca_0042_column_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN first_login_completed_at DATETIME(3) NULL AFTER verified_at',
  'SELECT 1'
);
PREPARE pca_0042_stmt FROM @pca_0042_alter_sql;
EXECUTE pca_0042_stmt;
DEALLOCATE PREPARE pca_0042_stmt;
