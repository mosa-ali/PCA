-- PCA-DB-MYSQL-1: MySQL 8.4 baseline, replacing the PostgreSQL migration
-- chain (0001-0006, preserved in git history). This is a rebaseline, not a
-- port of intermediate history: it reflects the final schema shape those
-- six migrations produced, expressed in MySQL 8.4 / InnoDB types.
--
-- PRIVACY BOUNDARY (unchanged from the PostgreSQL schema): all identifiers
-- are opaque application references; no activity, policy, location, PIN,
-- private key, FDEK, recovery secret, URL, title, search query, or
-- readable child data may ever be added to this database. See
-- backend/test/db/schema-privacy.mysql.test.mjs for the enforced guard.
--
-- TYPE DECISIONS:
--  * Application-generated UUIDs -> CHAR(36) CHARACTER SET ascii COLLATE
--    ascii_bin (fixed-width, case-sensitive exact match; never parsed by
--    MySQL as a value, just an opaque 36-byte string).
--  * Opaque bounded application identifiers (family_id, sender/recipient
--    device id, message_id, release_id, signing_key_id, public_key) ->
--    VARCHAR(n) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin, bounded to the
--    same MAX_*_LENGTH the domain layer already enforces (see src/*/policy.ts)
--    so the schema never contradicts isPlausibleOpaqueId's own bound.
--    utf8mb4_bin gives exact byte-for-byte matching, matching Postgres's
--    default C-collation TEXT comparison -- never a case- or accent-folded
--    match on an opaque reference.
--  * Fixed-length lowercase-hex values (token_hash, artifact_digest) ->
--    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin.
--  * Ciphertext / opaque signed blobs -> MEDIUMBLOB (up to 16MB; BLOB's 64KB
--    cap is not a safe bound for a signed release manifest or a family
--    recovery envelope).
--  * Hash columns (account/family/license reference hashes) -> VARBINARY(255):
--    long enough for any realistic MAC/hash digest, short enough to stay
--    well under InnoDB's ~3072-byte unique-index key limit.
--  * All application timestamps -> DATETIME(3) NOT NULL, always written and
--    read as UTC. The connection pool (backend/src/db/pool.ts) pins
--    `timezone: 'Z'` so no query ever depends on the MySQL server's local
--    session timezone -- this is the explicit UTC strategy for every
--    TIMESTAMPTZ column the PostgreSQL schema used.
--  * CHECK constraints are recreated 1:1 (MySQL 8.0.16+/8.4 enforces CHECK,
--    it is not merely parsed and ignored as in older MySQL).

CREATE TABLE schema_migrations (
  version VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB;

CREATE TABLE service_accounts (
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_reference_hash VARBINARY(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  disabled_at DATETIME(3) NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY service_accounts_account_reference_hash_key (account_reference_hash)
) ENGINE=InnoDB;

CREATE TABLE families (
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_reference_hash VARBINARY(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (family_id),
  UNIQUE KEY families_family_reference_hash_key (family_reference_hash)
) ENGINE=InnoDB;

CREATE TABLE licenses (
  license_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  license_reference_hash VARBINARY(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  PRIMARY KEY (license_id),
  UNIQUE KEY licenses_license_reference_hash_key (license_reference_hash),
  KEY licenses_account_id_idx (account_id),
  CONSTRAINT licenses_account_id_fk FOREIGN KEY (account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT licenses_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED'))
) ENGINE=InnoDB;

CREATE TABLE security_audit_metadata (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  actor_reference_hash VARBINARY(255) NULL,
  subject_reference_hash VARBINARY(255) NULL,
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  CONSTRAINT security_audit_metadata_event_type_check
    CHECK (event_type IN ('ACCOUNT_DISABLED', 'DEVICE_REVOKED', 'KEY_REVOKED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Service control-plane authentication
-- ---------------------------------------------------------------------

CREATE TABLE service_sessions (
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (session_id),
  UNIQUE KEY service_sessions_token_hash_key (token_hash),
  KEY service_sessions_account_id_idx (account_id),
  CONSTRAINT service_sessions_account_id_fk FOREIGN KEY (account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT service_sessions_token_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Minimal service control-plane authorization relation (NOT family RBAC --
-- see src/authz/policy.ts)
-- ---------------------------------------------------------------------

CREATE TABLE service_account_family_scopes (
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (account_id, family_id),
  KEY service_account_family_scopes_family_id_idx (family_id),
  CONSTRAINT service_account_family_scopes_account_id_fk FOREIGN KEY (account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT service_account_family_scopes_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT service_account_family_scopes_status_check CHECK (status IN ('ACTIVE', 'REVOKED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Enrollment invitations
-- ---------------------------------------------------------------------

CREATE TABLE enrollment_invitations (
  invitation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform VARCHAR(16) NOT NULL,
  requested_protection_mode VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  opened_at DATETIME(3) NULL,
  redeemed_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (invitation_id),
  UNIQUE KEY enrollment_invitations_token_hash_key (token_hash),
  KEY enrollment_invitations_family_id_idx (family_id),
  CONSTRAINT enrollment_invitations_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT enrollment_invitations_token_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT enrollment_invitations_platform_check CHECK (platform IN ('ANDROID', 'IOS')),
  CONSTRAINT enrollment_invitations_protection_mode_check
    CHECK (requested_protection_mode IN ('ANDROID_STANDARD', 'ANDROID_PROTECTED', 'IOS_STANDARD')),
  CONSTRAINT enrollment_invitations_status_check CHECK (status IN ('CREATED', 'OPENED', 'REDEEMED', 'REVOKED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Device identity / public-key directory
-- ---------------------------------------------------------------------

CREATE TABLE devices (
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  platform VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  -- ENROLL-HARDEN-2: parent confirmation bookkeeping only, never family
  -- E2EE trust authority (that remains the device-side Family Trust Set).
  paired_at DATETIME(3) NULL,
  paired_by_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (device_id),
  KEY devices_family_id_idx (family_id),
  CONSTRAINT devices_paired_by_account_id_fk FOREIGN KEY (paired_by_account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT devices_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT devices_platform_check CHECK (platform IN ('ANDROID', 'IOS')),
  CONSTRAINT devices_status_check CHECK (status IN ('PAIRING_PENDING', 'PAIRED', 'ACTIVE', 'REVOKED'))
) ENGINE=InnoDB;

CREATE TABLE device_public_keys (
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- ENROLL-HARDEN-2: Device Signing Key vs Device Encryption/Key-Agreement
  -- Key are distinct roles, never one generic key pair.
  key_purpose VARCHAR(8) NOT NULL,
  public_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (device_id, key_id),
  -- A public key may never be registered more than once, full stop -- not
  -- merely "not twice while ACTIVE". Revoked key material is permanently
  -- tombstoned (see PostgreSQL migration 0002 for the full rationale,
  -- unchanged here): a single UNIQUE index across ALL families/devices,
  -- covering the row's entire lifetime regardless of status.
  UNIQUE KEY device_public_keys_public_key_key (public_key),
  KEY device_public_keys_device_id_idx (device_id),
  CONSTRAINT device_public_keys_device_id_fk FOREIGN KEY (device_id) REFERENCES devices (device_id),
  CONSTRAINT device_public_keys_key_purpose_check CHECK (key_purpose IN ('DSK', 'DEK')),
  CONSTRAINT device_public_keys_status_check CHECK (status IN ('ACTIVE', 'REVOKED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Device-authentication challenges
-- ---------------------------------------------------------------------

CREATE TABLE device_challenges (
  challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  nonce VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (challenge_id),
  KEY device_challenges_device_id_idx (device_id),
  CONSTRAINT device_challenges_device_id_fk FOREIGN KEY (device_id) REFERENCES devices (device_id),
  CONSTRAINT device_challenges_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT device_challenges_nonce_check CHECK (CHAR_LENGTH(nonce) BETWEEN 1 AND 256)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Opaque store-and-forward relay
-- ---------------------------------------------------------------------

CREATE TABLE relay_envelopes (
  message_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  sender_device_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  recipient_device_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  ciphertext MEDIUMBLOB NOT NULL,
  state VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  acknowledged_at DATETIME(3) NULL,
  PRIMARY KEY (message_id),
  -- Serves recipient-scoped queued-envelope listing; never indexes ciphertext content.
  KEY relay_envelopes_recipient_state_idx (recipient_device_id, state, expires_at),
  CONSTRAINT relay_envelopes_message_id_check CHECK (CHAR_LENGTH(message_id) BETWEEN 1 AND 128),
  CONSTRAINT relay_envelopes_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT relay_envelopes_sender_device_id_check CHECK (CHAR_LENGTH(sender_device_id) BETWEEN 1 AND 128),
  CONSTRAINT relay_envelopes_recipient_device_id_check CHECK (CHAR_LENGTH(recipient_device_id) BETWEEN 1 AND 128),
  CONSTRAINT relay_envelopes_state_check CHECK (state IN ('QUEUED', 'ACKNOWLEDGED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Opaque family recovery envelope
-- ---------------------------------------------------------------------

CREATE TABLE recovery_envelopes (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  ciphertext MEDIUMBLOB NOT NULL,
  version INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (family_id),
  CONSTRAINT recovery_envelopes_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT recovery_envelopes_version_check CHECK (version > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Signed release/model/rule metadata
-- ---------------------------------------------------------------------

CREATE TABLE release_packages (
  release_id VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  package_type VARCHAR(32) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  version VARCHAR(32) NOT NULL,
  artifact_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  artifact_size_bytes BIGINT UNSIGNED NOT NULL,
  signing_key_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  signed_metadata MEDIUMBLOB NOT NULL,
  minimum_supported_version VARCHAR(32) NULL,
  state VARCHAR(16) NOT NULL,
  published_at DATETIME(3) NOT NULL,
  retired_at DATETIME(3) NULL,
  PRIMARY KEY (release_id),
  UNIQUE KEY release_packages_identity_key (package_type, platform, version),
  CONSTRAINT release_packages_release_id_check CHECK (CHAR_LENGTH(release_id) BETWEEN 1 AND 256),
  CONSTRAINT release_packages_package_type_check
    CHECK (package_type IN ('ANDROID_APP', 'IOS_APP', 'MODEL_PACKAGE', 'RULE_PACKAGE')),
  CONSTRAINT release_packages_platform_check CHECK (platform IN ('ANDROID', 'IOS', 'SHARED')),
  CONSTRAINT release_packages_version_check CHECK (version REGEXP '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'),
  CONSTRAINT release_packages_artifact_digest_check CHECK (artifact_digest REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT release_packages_artifact_size_bytes_check CHECK (artifact_size_bytes > 0),
  CONSTRAINT release_packages_signing_key_id_check CHECK (CHAR_LENGTH(signing_key_id) BETWEEN 1 AND 128),
  CONSTRAINT release_packages_minimum_supported_version_check
    CHECK (minimum_supported_version IS NULL OR minimum_supported_version REGEXP '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'),
  CONSTRAINT release_packages_state_check CHECK (state IN ('PUBLISHED', 'RETIRED'))
) ENGINE=InnoDB;

-- version_major/minor/patch mirror the `version` string as integers so the
-- "only advance forward" rule can be enforced as a single atomic
-- INSERT ... ON DUPLICATE KEY UPDATE with a row-constructor comparison
-- (MySQL supports `(a, b, c) > (d, e, f)` lexicographic row comparisons)
-- gating each assigned column, rather than a SELECT ... FOR UPDATE, which
-- cannot lock a row that does not exist yet.
CREATE TABLE release_current_pointers (
  package_type VARCHAR(32) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  version VARCHAR(32) NOT NULL,
  version_major INT UNSIGNED NOT NULL,
  version_minor INT UNSIGNED NOT NULL,
  version_patch INT UNSIGNED NOT NULL,
  is_explicit_rollback BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (package_type, platform)
) ENGINE=InnoDB;
