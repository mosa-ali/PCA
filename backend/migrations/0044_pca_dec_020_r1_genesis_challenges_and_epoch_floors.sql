-- PCA-DEC-020-R1 SOURCE-ONLY DRAFT.
-- Production execution is not authorized by the R1 lane.

CREATE TABLE parent_genesis_challenges (
  challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  service_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_public_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'BROWSER',
  nonce VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  protocol_version SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (challenge_id),
  KEY parent_genesis_challenges_account_idx (account_id, created_at),
  KEY parent_genesis_challenges_family_idx (family_id),
  CONSTRAINT parent_genesis_challenges_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_genesis_challenges_service_account_fk FOREIGN KEY (service_account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT parent_genesis_challenges_operation_check CHECK (operation = 'GENESIS'),
  CONSTRAINT parent_genesis_challenges_protocol_check CHECK (protocol_version = 1),
  CONSTRAINT parent_genesis_challenges_platform_check CHECK (candidate_platform IN ('ANDROID', 'IOS', 'BROWSER')),
  CONSTRAINT parent_genesis_challenges_nonce_check CHECK (CHAR_LENGTH(nonce) = 43),
  CONSTRAINT parent_genesis_challenges_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE family_authority_request_challenges (
  challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  service_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  public_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  protocol_version SMALLINT UNSIGNED NOT NULL,
  nonce VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_digest VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (challenge_id),
  KEY family_authority_request_challenges_scope_idx (service_account_id, family_id, issued_at),
  CONSTRAINT family_authority_request_challenges_service_fk FOREIGN KEY (service_account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT family_authority_request_challenges_operation_check CHECK (operation REGEXP '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT family_authority_request_challenges_protocol_check CHECK (protocol_version = 1),
  CONSTRAINT family_authority_request_challenges_nonce_check CHECK (CHAR_LENGTH(nonce) = 43),
  CONSTRAINT family_authority_request_challenges_digest_check CHECK (CHAR_LENGTH(request_digest) = 43),
  CONSTRAINT family_authority_request_challenges_expiry_check CHECK (expires_at > issued_at)
) ENGINE=InnoDB;

ALTER TABLE family_authority_chain_heads
  ADD COLUMN required_trust_set_epoch INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN required_key_epoch INT UNSIGNED NOT NULL DEFAULT 1,
  ADD CONSTRAINT family_authority_chain_heads_epoch_check
    CHECK (required_trust_set_epoch >= 1 AND required_key_epoch >= 1);
