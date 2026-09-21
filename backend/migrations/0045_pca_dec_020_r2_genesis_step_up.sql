-- PCA-DEC-020-R2 SOURCE-ONLY. Production execution is not authorized by this lane.
-- A genesis authorization is a short-lived, one-time, exact-session binding.
-- Only a keyed code hash and a hash of AuthService's opaque sessionId are stored.

CREATE TABLE parent_genesis_step_up_authorizations (
  authorization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  service_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  verified_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (authorization_id),
  KEY parent_genesis_step_up_session_idx (account_id, service_account_id, session_id_hash, created_at),
  CONSTRAINT parent_genesis_step_up_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_genesis_step_up_service_account_fk FOREIGN KEY (service_account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT parent_genesis_step_up_operation_check CHECK (operation = 'FAMILY_GENESIS'),
  CONSTRAINT parent_genesis_step_up_session_hash_check CHECK (CHAR_LENGTH(session_id_hash) = 64),
  CONSTRAINT parent_genesis_step_up_code_hash_check CHECK (CHAR_LENGTH(code_hash) = 64),
  CONSTRAINT parent_genesis_step_up_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;

ALTER TABLE parent_genesis_challenges
  ADD COLUMN genesis_authorization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER candidate_platform,
  ADD KEY parent_genesis_challenges_authorization_idx (genesis_authorization_id),
  ADD CONSTRAINT parent_genesis_challenges_authorization_fk
    FOREIGN KEY (genesis_authorization_id) REFERENCES parent_genesis_step_up_authorizations (authorization_id);
