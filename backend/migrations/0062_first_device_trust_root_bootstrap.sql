-- 0062_first_device_trust_root_bootstrap.sql
-- Wave 6B: durable one-time first-device Trust Set root bootstrap ceremony state.
-- Owner rulings D4/F4/F5 (PCA_FIRST_DEVICE_BOOTSTRAP_V1 / PCA_FAMILY_TRUST_ROOT_V1).
--
-- Additive only. This migration stores PUBLIC key material, ceremony state and
-- a signature-scheme discriminator exclusively -- no private keys, no recovery
-- envelopes, no server-held family keys. LIVE APPLICATION IS NOT AUTHORIZED.
--
-- The ceremony table below is the durable one-time challenge + committed-result
-- record for the first-device trust-root ceremony. Consumption semantics are
-- enforced by the application store inside ONE transaction spanning challenge
-- state, the family root anchor and accepted trust-set epoch 1 (see
-- backend/src/familytrustset/MySqlFirstDeviceBootstrapStore.ts).
CREATE TABLE IF NOT EXISTS family_first_device_bootstrap_ceremonies (
  ceremony_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dsk_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dsk_public_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  dsk_algorithm VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approved_by_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  approved_at DATETIME(3) NULL,
  payload_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  outcome VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (ceremony_id),
  KEY family_first_device_bootstrap_ceremonies_family_idx (family_id, created_at),
  KEY family_first_device_bootstrap_ceremonies_device_idx (device_id),
  CONSTRAINT family_first_device_bootstrap_ceremonies_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT family_first_device_bootstrap_ceremonies_device_id_check CHECK (CHAR_LENGTH(device_id) = 36),
  CONSTRAINT family_first_device_bootstrap_ceremonies_dsk_key_id_check CHECK (CHAR_LENGTH(dsk_key_id) = 36),
  CONSTRAINT family_first_device_bootstrap_ceremonies_dsk_public_key_check CHECK (CHAR_LENGTH(dsk_public_key) BETWEEN 1 AND 128),
  CONSTRAINT family_first_device_bootstrap_ceremonies_dsk_algorithm_check CHECK (dsk_algorithm = 'ECDSA_P256_SHA256'),
  CONSTRAINT family_first_device_bootstrap_ceremonies_purpose_check CHECK (purpose = 'PCA_FIRST_DEVICE_BOOTSTRAP_V1'),
  CONSTRAINT family_first_device_bootstrap_ceremonies_challenge_id_check CHECK (CHAR_LENGTH(challenge_id) = 36),
  CONSTRAINT family_first_device_bootstrap_ceremonies_nonce_check CHECK (CHAR_LENGTH(nonce) = 43),
  CONSTRAINT family_first_device_bootstrap_ceremonies_status_check CHECK (status IN ('PENDING', 'APPROVED', 'COMMITTED')),
  CONSTRAINT family_first_device_bootstrap_ceremonies_outcome_check CHECK (outcome IS NULL OR outcome = 'ACCEPTED'),
  CONSTRAINT family_first_device_bootstrap_ceremonies_payload_digest_check CHECK (payload_digest IS NULL OR payload_digest REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT family_first_device_bootstrap_ceremonies_approved_pair_check CHECK ((approved_by_account_id IS NULL) = (approved_at IS NULL)),
  CONSTRAINT family_first_device_bootstrap_ceremonies_committed_pair_check CHECK (payload_digest IS NULL OR (status = 'COMMITTED' AND consumed_at IS NOT NULL)),
  CONSTRAINT family_first_device_bootstrap_ceremonies_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;

-- Anchor signature-scheme discriminator (Wave-6A contradiction C2 resolution /
-- smoke S2-F3): migration 0011 documents anchor.signature as a
-- PCA_FAMILY_AUTHORITY_GENESIS_V1 self-signature, while the approved
-- first-device ceremony records its PCA_FIRST_DEVICE_BOOTSTRAP_V1 proof
-- signature. The two schemes are cryptographically disjoint (different
-- canonical tuples), but both used protocol_version = 1 -- this column makes
-- the scheme explicit instead of ambiguous. Default preserves the documented
-- 0011 semantics for any pre-existing row.
SET @pca_0062_anchor_scheme_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'family_authority_genesis_anchors'
     AND column_name = 'signature_scheme'
);
SET @pca_0062_anchor_scheme_sql = IF(
  @pca_0062_anchor_scheme_exists = 0,
  'ALTER TABLE family_authority_genesis_anchors ADD COLUMN signature_scheme VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''PCA_FAMILY_AUTHORITY_GENESIS_V1''',
  'SELECT 1'
);
PREPARE pca_0062_anchor_scheme_stmt FROM @pca_0062_anchor_scheme_sql;
EXECUTE pca_0062_anchor_scheme_stmt;
DEALLOCATE PREPARE pca_0062_anchor_scheme_stmt;

-- Give first-device trust-root bootstrap its own one-use, account/family/action-bound
-- Parent MFA step-up operation (owner ruling D4). Follows the staged 0055 pattern:
-- create the CHECK if absent, otherwise widen it only when the new marker is missing.
SET @pca_0062_operation_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_mfa_step_up_grants'
     AND constraint_name = 'parent_mfa_step_up_grants_operation_check'
);
SET @pca_0062_operation_check_has_bootstrap_root = (
  SELECT COUNT(*) FROM information_schema.check_constraints cc
   JOIN information_schema.table_constraints tc
     ON tc.constraint_schema = cc.constraint_schema
    AND tc.constraint_name = cc.constraint_name
   WHERE tc.constraint_schema = DATABASE() AND tc.table_name = 'parent_mfa_step_up_grants'
     AND tc.constraint_name = 'parent_mfa_step_up_grants_operation_check'
     AND cc.check_clause LIKE '%family.device.bootstrap.root%'
);
SET @pca_0062_operation_check_sql = IF(
  @pca_0062_operation_check_exists = 0,
  'ALTER TABLE parent_mfa_step_up_grants ADD CONSTRAINT parent_mfa_step_up_grants_operation_check CHECK (operation IN (''BILLING_CHECKOUT_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_RESUME'', ''family.member.add'', ''family.member.remove'', ''family.member.role_change'', ''family.member.invitation.revoke'', ''family.device.enrollment.create'', ''family.device.enrollment.revoke'', ''family.device.bootstrap.root'', ''family.retention.update'', ''family.history.export'', ''family.history.delete'', ''family.ownership.transfer'', ''family.recovery.material.reveal'', ''family.security.settings.change''))',
  IF(
    @pca_0062_operation_check_has_bootstrap_root = 0,
    'ALTER TABLE parent_mfa_step_up_grants DROP CHECK parent_mfa_step_up_grants_operation_check, ADD CONSTRAINT parent_mfa_step_up_grants_operation_check CHECK (operation IN (''BILLING_CHECKOUT_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_RESUME'', ''family.member.add'', ''family.member.remove'', ''family.member.role_change'', ''family.member.invitation.revoke'', ''family.device.enrollment.create'', ''family.device.enrollment.revoke'', ''family.device.bootstrap.root'', ''family.retention.update'', ''family.history.export'', ''family.history.delete'', ''family.ownership.transfer'', ''family.recovery.material.reveal'', ''family.security.settings.change''))',
    'SELECT 1'
  )
);
PREPARE pca_0062_operation_check_stmt FROM @pca_0062_operation_check_sql;
EXECUTE pca_0062_operation_check_stmt;
DEALLOCATE PREPARE pca_0062_operation_check_stmt;
