-- Wave 02B: bounded activation target and Device Policy Application Proof V1.
-- Additive only. No policy plaintext, family receipt plaintext, raw DSK
-- signature, or challenge nonce is persisted here. Proof rows are 14-day
-- idempotency tombstones; devices.activated_at is the durable lifecycle fact.

CREATE TABLE IF NOT EXISTS device_policy_activation_targets (
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_generation BIGINT UNSIGNED NOT NULL,
  policy_message_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  policy_envelope_sha256 BINARY(32) NULL,
  policy_envelope_expires_at DATETIME(3) NULL,
  canonical_envelope_bytes MEDIUMBLOB NULL,
  envelope_signature BINARY(64) NULL,
  trust_set_epoch INT UNSIGNED NULL,
  key_epoch INT UNSIGNED NULL,
  target_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bootstrap_capability_hash BINARY(32) NULL,
  bootstrap_capability_expires_at DATETIME(3) NULL,
  bootstrap_capability_consumed_at DATETIME(3) NULL,
  challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  challenge_nonce_hash BINARY(32) NULL,
  challenge_expires_at DATETIME(3) NULL,
  challenge_consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (device_id),
  UNIQUE KEY device_policy_activation_targets_family_device_key (family_id, device_id),
  UNIQUE KEY device_policy_activation_targets_challenge_key (challenge_id),
  KEY device_policy_activation_targets_family_state_idx (family_id, target_state),
  CONSTRAINT device_policy_activation_targets_device_fk
    FOREIGN KEY (device_id) REFERENCES devices (device_id),
  CONSTRAINT device_policy_activation_targets_family_fk
    FOREIGN KEY (family_id) REFERENCES families (family_id),
  CONSTRAINT device_policy_activation_targets_state_check
    CHECK (target_state IN ('PENDING', 'ACTIVATED')),
  CONSTRAINT device_policy_activation_targets_generation_check
    CHECK (target_generation >= 1),
  CONSTRAINT device_policy_activation_targets_pending_check CHECK (
    (target_state = 'PENDING' AND policy_message_id IS NOT NULL AND
     policy_envelope_sha256 IS NOT NULL AND canonical_envelope_bytes IS NOT NULL AND
     policy_envelope_expires_at IS NOT NULL AND envelope_signature IS NOT NULL AND
     trust_set_epoch IS NOT NULL AND key_epoch IS NOT NULL)
    OR
    (target_state = 'ACTIVATED' AND policy_message_id IS NOT NULL AND
     policy_envelope_sha256 IS NOT NULL AND canonical_envelope_bytes IS NULL AND
     envelope_signature IS NULL AND bootstrap_capability_hash IS NULL AND
     bootstrap_capability_expires_at IS NULL AND bootstrap_capability_consumed_at IS NULL AND
     challenge_id IS NULL AND challenge_nonce_hash IS NULL AND challenge_expires_at IS NULL AND
     challenge_consumed_at IS NULL)
  ),
  CONSTRAINT device_policy_activation_targets_envelope_size_check
    CHECK (canonical_envelope_bytes IS NULL OR OCTET_LENGTH(canonical_envelope_bytes) BETWEEN 1 AND 98304),
  CONSTRAINT device_policy_activation_targets_message_id_check
    CHECK (policy_message_id IS NULL OR CHAR_LENGTH(policy_message_id) BETWEEN 1 AND 128),
  CONSTRAINT device_policy_activation_targets_epoch_check
    CHECK ((trust_set_epoch IS NULL OR trust_set_epoch >= 1) AND (key_epoch IS NULL OR key_epoch >= 1)),
  CONSTRAINT device_policy_activation_targets_capability_pair_check
    CHECK ((bootstrap_capability_hash IS NULL) = (bootstrap_capability_expires_at IS NULL)),
  CONSTRAINT device_policy_activation_targets_challenge_pair_check CHECK (
    (challenge_id IS NULL AND challenge_nonce_hash IS NULL AND challenge_expires_at IS NULL) OR
    (challenge_id IS NOT NULL AND challenge_nonce_hash IS NOT NULL AND challenge_expires_at IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS device_policy_application_proofs (
  challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_generation BIGINT UNSIGNED NOT NULL,
  policy_message_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  policy_envelope_sha256 BINARY(32) NOT NULL,
  trust_set_epoch INT UNSIGNED NOT NULL,
  key_epoch INT UNSIGNED NOT NULL,
  application_result VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  challenge_expires_at DATETIME(3) NOT NULL,
  challenge_consumed_at DATETIME(3) NOT NULL,
  canonical_transcript_sha256 BINARY(32) NOT NULL,
  exact_request_sha256 BINARY(32) NOT NULL,
  activation_outcome VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  received_at DATETIME(3) NOT NULL,
  committed_at DATETIME(3) NOT NULL,
  retention_expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (challenge_id),
  KEY device_policy_application_proofs_device_received_idx (device_id, received_at),
  KEY device_policy_application_proofs_retention_idx (retention_expires_at),
  CONSTRAINT device_policy_application_proofs_device_fk
    FOREIGN KEY (device_id) REFERENCES devices (device_id),
  CONSTRAINT device_policy_application_proofs_family_fk
    FOREIGN KEY (family_id) REFERENCES families (family_id),
  CONSTRAINT device_policy_application_proofs_generation_check CHECK (target_generation >= 1),
  CONSTRAINT device_policy_application_proofs_message_id_check
    CHECK (CHAR_LENGTH(policy_message_id) BETWEEN 1 AND 128),
  CONSTRAINT device_policy_application_proofs_epochs_check
    CHECK (trust_set_epoch >= 1 AND key_epoch >= 1),
  CONSTRAINT device_policy_application_proofs_result_check
    CHECK (application_result IN ('APPLIED', 'DEGRADED', 'REJECTED')),
  CONSTRAINT device_policy_application_proofs_outcome_check
    CHECK (activation_outcome IN ('ACTIVATED', 'RECORDED_NOT_ACTIVATED')),
  CONSTRAINT device_policy_application_proofs_retention_check
    CHECK (retention_expires_at > committed_at)
) ENGINE=InnoDB;

-- Durable lifecycle fact survives pruning of short-lived replay tombstones.
SET @pca_0066_activated_at_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'activated_at'
);
SET @pca_0066_activated_at_sql = IF(
  @pca_0066_activated_at_exists = 0,
  'ALTER TABLE devices ADD COLUMN activated_at DATETIME(3) NULL AFTER paired_at',
  'SELECT 1'
);
PREPARE pca_0066_activated_at_stmt FROM @pca_0066_activated_at_sql;
EXECUTE pca_0066_activated_at_stmt;
DEALLOCATE PREPARE pca_0066_activated_at_stmt;

-- A least-privilege, bounded retention entry point. The application runtime
-- receives EXECUTE only; it never receives DELETE on the proof ledger.
DROP PROCEDURE IF EXISTS pca_prune_expired_device_policy_proofs;
CREATE PROCEDURE pca_prune_expired_device_policy_proofs(
  IN requested_batch_size INT UNSIGNED,
  OUT deleted_count INT UNSIGNED
)
SQL SECURITY DEFINER
BEGIN
  IF requested_batch_size < 1 OR requested_batch_size > 500 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'proof_tombstone_prune_batch_out_of_range';
  END IF;
  DELETE FROM device_policy_application_proofs
   WHERE retention_expires_at <= UTC_TIMESTAMP(3)
   ORDER BY retention_expires_at ASC, challenge_id ASC
   LIMIT requested_batch_size;
  SET deleted_count = ROW_COUNT();
END;
