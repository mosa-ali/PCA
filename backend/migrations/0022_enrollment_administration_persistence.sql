-- PCA-ADD-ENR-012/016/017: durable enrollment-administration state.
--
-- The verifier table stores only the salted, deliberately slow verifier
-- material and bounded failure bookkeeping. It never stores the raw PIN.
-- The approval table stores opaque child/device references and the closed
-- state vocabulary needed by the parent-facing approval lifecycle. It does
-- not assert family authority: protective_authority_applies is written only
-- after the enrollment coordinator has resolved that boundary.

CREATE TABLE enrollment_administration_verifiers (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  salt_b64 VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verifier_b64 VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (family_id),
  CONSTRAINT enrollment_administration_verifiers_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT enrollment_administration_verifiers_salt_check CHECK (CHAR_LENGTH(salt_b64) BETWEEN 1 AND 32),
  CONSTRAINT enrollment_administration_verifiers_verifier_check CHECK (CHAR_LENGTH(verifier_b64) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

CREATE TABLE enrollment_protection_approval_requests (
  request_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  child_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  device_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  operation VARCHAR(32) NOT NULL,
  protection_level VARCHAR(32) NOT NULL,
  requested_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  reason_category VARCHAR(32) NULL,
  protective_authority_applies TINYINT UNSIGNED NOT NULL,
  state VARCHAR(32) NOT NULL,
  decided_at DATETIME(3) NULL,
  decision_method VARCHAR(32) NULL,
  temporary_disable_until DATETIME(3) NULL,
  PRIMARY KEY (request_id),
  KEY enrollment_protection_approval_family_state_idx (family_id, state, expires_at),
  CONSTRAINT enrollment_protection_approval_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT enrollment_protection_approval_child_id_check CHECK (CHAR_LENGTH(child_id) BETWEEN 1 AND 200),
  CONSTRAINT enrollment_protection_approval_device_id_check CHECK (CHAR_LENGTH(device_id) BETWEEN 1 AND 200),
  CONSTRAINT enrollment_protection_approval_window_check CHECK (expires_at > requested_at),
  CONSTRAINT enrollment_protection_approval_operation_check CHECK (operation IN ('REMOVE_REVOKE_DEVICE', 'DISABLE_PROTECTION_POLICY')),
  CONSTRAINT enrollment_protection_approval_level_check CHECK (protection_level IN ('STANDARD', 'PROTECTED', 'DEGRADED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED')),
  CONSTRAINT enrollment_protection_approval_reason_check CHECK (reason_category IS NULL OR reason_category IN ('ROUTINE_POLICY_CHANGE', 'CHILD_SAFETY_CONCERN', 'DEVICE_LOST_OR_STOLEN', 'FAMILY_MEMBERSHIP_CHANGE', 'RECOVERY', 'OTHER')),
  CONSTRAINT enrollment_protection_approval_authority_check CHECK (protective_authority_applies = 1),
  CONSTRAINT enrollment_protection_approval_state_check CHECK (state IN ('PARENT_APPROVAL_REQUIRED', 'KEEP_ACTIVE', 'TEMPORARILY_DISABLE', 'ALLOW_REMOVAL')),
  CONSTRAINT enrollment_protection_approval_method_check CHECK (decision_method IS NULL OR decision_method IN ('REMOTE_PARENT', 'LOCAL_ADMINISTRATION_PIN', 'AUTHORIZED_RECOVERY'))
) ENGINE=InnoDB;
