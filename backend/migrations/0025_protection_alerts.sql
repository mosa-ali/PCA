-- PCA-ADD-ENR-020: durable, append-only relay ledger for opaque protection
-- alert envelopes. Mirrors ProtectionAlertLedger's own contract exactly:
-- no acknowledge/decrypt/plaintext-read operation exists here or ever will
-- -- parent acknowledgement and display state belong to the trusted parent
-- device after local decryption. This table stores only opaque ciphertext
-- and typed routing metadata (family/device/trigger/epoch), never readable
-- family detail.

CREATE TABLE protection_alerts (
  alert_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  device_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  parent_device_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  trigger_type VARCHAR(32) NOT NULL,
  key_epoch INT UNSIGNED NOT NULL,
  generated_at_utc DATETIME(3) NOT NULL,
  encrypted_payload_b64 MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce_b64 VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (alert_id),
  KEY protection_alerts_family_idx (family_id, generated_at_utc),
  KEY protection_alerts_parent_device_idx (family_id, parent_device_id, generated_at_utc),
  CONSTRAINT protection_alerts_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT protection_alerts_device_id_check CHECK (device_id IS NULL OR CHAR_LENGTH(device_id) BETWEEN 1 AND 200),
  CONSTRAINT protection_alerts_parent_device_id_check CHECK (CHAR_LENGTH(parent_device_id) BETWEEN 1 AND 200),
  CONSTRAINT protection_alerts_trigger_check CHECK (trigger_type IN (
    'DISABLE_OR_REMOVAL_REQUESTED', 'REPEATED_INVALID_PIN', 'AUTHORITY_CHANGE',
    'CRITICAL_PERMISSION_OR_VPN_LOST', 'UNEXPECTED_OFFLINE', 'TIME_TAMPERING',
    'PROTECTION_DEGRADED', 'REINSTALLATION', 'INVITATION_REDEEMED', 'UNENROLLMENT'
  )),
  CONSTRAINT protection_alerts_key_epoch_check CHECK (key_epoch >= 0),
  CONSTRAINT protection_alerts_payload_check CHECK (CHAR_LENGTH(encrypted_payload_b64) BETWEEN 1 AND 4194304),
  CONSTRAINT protection_alerts_nonce_check CHECK (CHAR_LENGTH(nonce_b64) BETWEEN 1 AND 64)
) ENGINE=InnoDB;
