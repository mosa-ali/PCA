-- PCA Parent daily login verification (source-only, pre-production).
-- A successful normal-login email OTP creates one opaque browser grant for
-- 24 hours. Only the domain-separated SHA-256 token hash is persisted; the
-- raw token exists only in the HttpOnly cookie set on the successful response.
-- This is deliberately account-bound and is not an account-level "last OTP"
-- flag, so a grant in Browser A cannot bypass OTP in Browser B.
--
-- The purpose check keeps this artifact separate from session tokens, email
-- verification codes, password-reset codes, and FAMILY_GENESIS authorization.
-- Production execution is a later owner-authorized gate.
--
-- IDEMPOTENCY (2026-09-21, PCA full assessment finding P1-07): this migration is
-- NOT YET APPLIED in production (which is at 0040), and scripts/migrate.mjs
-- records a file as applied only after it succeeds -- so a crash between MySQL
-- auto-committing this statement and the schema_migrations row being written
-- would leave the table present but unrecorded, and a retry would fail with
-- "table already exists". `IF NOT EXISTS` makes that retry a no-op.
CREATE TABLE IF NOT EXISTS parent_daily_login_grants (
  grant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (grant_id),
  UNIQUE KEY parent_daily_login_grants_token_hash_key (token_hash),
  KEY parent_daily_login_grants_account_expiry_idx (account_id, expires_at),
  CONSTRAINT parent_daily_login_grants_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_daily_login_grants_purpose_check CHECK (purpose = 'PARENT_DAILY_LOGIN'),
  CONSTRAINT parent_daily_login_grants_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT parent_daily_login_grants_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;
