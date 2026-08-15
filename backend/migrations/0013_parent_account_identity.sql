-- PCA-AUTH-SESSION-1 (PCA-DEC-026, FAMILY_SERVICE_SESSION_V1) -- self-service
-- parent/family account identity: email+password registration, one-time
-- email verification, and the FREE_ACCESS policy snapshot a verified
-- account receives. Introduces exactly two new tables. No existing table
-- (0001-0012) is altered.
--
-- ARCHITECTURAL INDEPENDENCE (PCA-ADD-IDENT-001): this is a wholly separate
-- credential domain from Platform Administration
-- (migrations/0005_platform_admin_identity_rbac_audit.sql's
-- platform_admin_accounts) -- no shared table, no shared session type. It is
-- ALSO deliberately separate from the generic `service_accounts`/
-- `service_sessions` tables (see backend/src/auth/ -- migration 0001):
-- session issuance for a verified parent account is delegated to the
-- EXISTING AuthService/service_sessions machinery (accountReferenceHash =
-- sha256(parent_accounts.account_id)) rather than reinventing a third
-- session-token table, per PCA_IMPL_DECISION_003's "no new session-issuance
-- contract is invented at the AuthService layer" -- this migration only adds
-- the identity/credential/verification-code state that PRODUCES the
-- VerifiedIdentity AuthService.issueSession already requires as input.
--
-- EMAIL PRIVACY (PCA-ADD-IDENT-003): `email_hash` is the ONLY queryable
-- form of the submitted email -- a SHA-256 of the normalized-lowercase
-- address (mirrors platform_admin_accounts.email_hash's pattern, computed
-- by an independent parentaccount/emailHash.ts, "adapted, not shared" per
-- PCA_IMPL_DECISION_003). No raw email column exists on this table.
--
-- FREE_ACCESS SNAPSHOT (PCA-ADD-IDENT-017/018): every column prefixed
-- `free_access_`/`default_` is written ONCE, at successful email
-- verification (never at registration, and never recomputed later merely
-- because platform-wide defaults changed -- PCA-ADD-IDENT-018's
-- snapshot-on-first-touch discipline, mirroring EntitlementService's own
-- getOrCreateForFamily pattern for FREE_STARTER).
--
-- FAMILY LINKAGE: `family_id` is nullable and is populated only once the
-- existing genesis/attestation-chain bootstrap
-- (backend/src/familycommercial/authority/) actually succeeds for this
-- account (see backend/src/parentaccount/ParentAccountService.ts's
-- verifyEmail method) -- this table never itself asserts family ownership,
-- it only records which family (if any) this identity is anchored to. No
-- FOREIGN KEY into any family-plane table exists (the family/commercial
-- plane's own tables already deliberately avoid FKs back into identity
-- tables -- see migration 0012's own header on this same isolation
-- principle).
CREATE TABLE parent_accounts (
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_hash BINARY(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_VERIFICATION',
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Deterministic lookup key back into the SHARED service_accounts table
  -- (sha256 of account_id) -- populated the first time a session is
  -- actually issued for this account (verify-email or login), so
  -- GET /api/parent/session can resolve a validated service-session token
  -- back to this row without ever storing or deriving the reverse
  -- direction (service_sessions/service_accounts have no column that could
  -- point back here).
  service_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  free_access_mode VARCHAR(16) NULL,
  free_access_duration_days INT NULL,
  free_access_started_at DATETIME(3) NULL,
  free_access_expires_at DATETIME(3) NULL,
  default_parent_member_limit INT NULL,
  default_managed_device_limit INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  verified_at DATETIME(3) NULL,
  disabled_at DATETIME(3) NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY parent_accounts_email_hash_key (email_hash),
  UNIQUE KEY parent_accounts_service_account_id_key (service_account_id),
  CONSTRAINT parent_accounts_status_check CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED')),
  CONSTRAINT parent_accounts_free_access_mode_check CHECK (free_access_mode IS NULL OR free_access_mode IN ('TIME_LIMITED', 'PERPETUAL')),
  -- A verified account always has its FREE_ACCESS snapshot written
  -- atomically with verified_at (PCA-ADD-IDENT-018); a PENDING_VERIFICATION
  -- account never has one yet.
  CONSTRAINT parent_accounts_verified_has_free_access_check CHECK (
    (status = 'PENDING_VERIFICATION' AND verified_at IS NULL AND free_access_mode IS NULL)
    OR (status = 'VERIFIED' AND verified_at IS NOT NULL AND free_access_mode IS NOT NULL)
  ),
  CONSTRAINT parent_accounts_time_limited_has_duration_check CHECK (
    NOT (free_access_mode = 'TIME_LIMITED' AND free_access_duration_days IS NULL)
  )
) ENGINE=InnoDB;

-- Single-use, TTL-bounded email verification codes (PCA-ADD-IDENT-005/007).
-- One row per issued code -- register (and a resend-while-still-PENDING)
-- inserts a new row rather than updating a prior one, so a stale code's
-- audit trail (created_at/expires_at/consumed_at) is never overwritten;
-- ParentAccountService only ever considers the MOST RECENT unconsumed,
-- unexpired row for a given account when verifying.
CREATE TABLE parent_email_verification_codes (
  code_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (code_id),
  KEY parent_email_verification_codes_account_idx (account_id, created_at),
  CONSTRAINT parent_email_verification_codes_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id)
) ENGINE=InnoDB;
