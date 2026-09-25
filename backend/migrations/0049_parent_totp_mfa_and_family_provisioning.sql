-- PCA owner architecture decision PCA-DEC-037 (2026-09-24): Parent Genesis is
-- removed. PARENT_AUTHORITY_MODEL = ACCOUNT + VERIFIED EMAIL + PASSWORD + TOTP
-- MFA, and COMMERCIAL_OWNER_AUTHORITY = FAMILY ADMINISTRATOR + FRESH TOTP
-- STEP-UP. This migration is ADDITIVE ONLY:
--
--   * parent_genesis_challenges / parent_genesis_step_up_authorizations
--     (0044/0045) are RETIRED, not dropped. Production presence and row counts
--     require read-only reconciliation before release; do not infer them from
--     source history. They are deferred to separately authorized cleanup.
--   * families gains provisioned_for_account_id, a UNIQUE marker that makes
--     "two initial families for one account" impossible at the database layer,
--     independent of the service-level row lock that normally prevents it.
--   * five parent_* tables carry TOTP MFA state, the enrollment ticket used when
--     a session may not yet be issued, the emailed MFA-recovery code, the
--     single-use commercial step-up grant, and an append-only security ledger.
--
-- IDEMPOTENCY: every CREATE is IF NOT EXISTS and the one ALTER is guarded by a
-- conditional PREPARE (0042/0043 idiom), so an interrupted first application
-- can be re-run by scripts/migrate.mjs without wedging the chain.

CREATE TABLE IF NOT EXISTS parent_mfa_state (
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- AES-256-GCM sealed TOTP secret (tag appended), PCA_PARENT_MFA_ENC_KEY keyring.
  totp_secret_ciphertext VARBINARY(255) NULL,
  totp_secret_nonce VARBINARY(16) NULL,
  -- Enrollment in progress: sealed separately so starting a new enrollment can
  -- never overwrite or weaken an ACTIVE factor before the new one is confirmed.
  pending_secret_ciphertext VARBINARY(255) NULL,
  pending_secret_nonce VARBINARY(16) NULL,
  pending_created_at DATETIME(3) NULL,
  last_accepted_totp_counter BIGINT NULL,
  -- Written exactly once, at the first successful Parent login. Never extended:
  -- a recovery reset can only SHORTEN grace_expires_at (LEAST(..., now)).
  grace_started_at DATETIME(3) NOT NULL,
  grace_expires_at DATETIME(3) NOT NULL,
  enrolled_at DATETIME(3) NULL,
  failed_attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  failure_window_started_at DATETIME(3) NULL,
  locked_until DATETIME(3) NULL,
  reset_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (account_id),
  CONSTRAINT parent_mfa_state_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_mfa_state_status_check CHECK (status IN ('NOT_ENROLLED', 'ACTIVE')),
  CONSTRAINT parent_mfa_state_active_check CHECK (
    status <> 'ACTIVE' OR (totp_secret_ciphertext IS NOT NULL AND totp_secret_nonce IS NOT NULL AND enrolled_at IS NOT NULL)
  ),
  CONSTRAINT parent_mfa_state_grace_check CHECK (grace_expires_at >= grace_started_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parent_mfa_enrollment_tickets (
  ticket_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (ticket_id),
  UNIQUE KEY parent_mfa_enrollment_tickets_token_hash_key (token_hash),
  KEY parent_mfa_enrollment_tickets_account_idx (account_id, expires_at),
  CONSTRAINT parent_mfa_enrollment_tickets_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_mfa_enrollment_tickets_purpose_check CHECK (purpose IN ('MFA_SETUP_REQUIRED', 'MFA_RECOVERY')),
  CONSTRAINT parent_mfa_enrollment_tickets_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT parent_mfa_enrollment_tickets_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parent_mfa_recovery_codes (
  code_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (code_id),
  KEY parent_mfa_recovery_codes_account_idx (account_id, created_at),
  CONSTRAINT parent_mfa_recovery_codes_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_mfa_recovery_codes_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parent_mfa_step_up_grants (
  grant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (grant_id),
  UNIQUE KEY parent_mfa_step_up_grants_token_hash_key (token_hash),
  KEY parent_mfa_step_up_grants_account_idx (account_id, expires_at),
  CONSTRAINT parent_mfa_step_up_grants_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_mfa_step_up_grants_family_fk FOREIGN KEY (family_id) REFERENCES families (family_id),
  CONSTRAINT parent_mfa_step_up_grants_operation_check CHECK (operation IN (
    'BILLING_CHECKOUT_CREATE',
    'FAMILY_COMMERCIAL_REQUEST_CREATE',
    'FAMILY_COMMERCIAL_REQUEST_CANCEL',
    'FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL',
    'FAMILY_COMMERCIAL_AUTO_RENEW_RESUME'
  )),
  CONSTRAINT parent_mfa_step_up_grants_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT parent_mfa_step_up_grants_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;

-- Append-only. No email, no IP, no secret: event type, an optional bounded
-- non-sensitive detail (a commercial operation name), and the instant.
CREATE TABLE IF NOT EXISTS parent_account_security_events (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  detail VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  occurred_at DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id),
  KEY parent_account_security_events_account_idx (account_id, occurred_at),
  CONSTRAINT parent_account_security_events_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_account_security_events_type_check CHECK (event_type IN (
    'FAMILY_PROVISIONED',
    'FIRST_LOGIN',
    'MFA_GRACE_STARTED',
    'MFA_ENROLLED',
    'MFA_LOGIN_FAILED',
    'MFA_LOCKED',
    'MFA_RECOVERY_REQUESTED',
    'MFA_RESET',
    'STEP_UP_GRANTED',
    'STEP_UP_FAILED',
    'STEP_UP_CONSUMED'
  ))
) ENGINE=InnoDB;

SET @pca_0049_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'families'
     AND column_name = 'provisioned_for_account_id'
);
SET @pca_0049_alter_sql = IF(
  @pca_0049_column_exists = 0,
  'ALTER TABLE families ADD COLUMN provisioned_for_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD UNIQUE KEY families_provisioned_for_account_key (provisioned_for_account_id)',
  'SELECT 1'
);
PREPARE pca_0049_stmt FROM @pca_0049_alter_sql;
EXECUTE pca_0049_stmt;
DEALLOCATE PREPARE pca_0049_stmt;
