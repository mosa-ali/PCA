-- PCA product-completion programme, Writer P0-D (/security/audit): durable,
-- append-only relay ledger for opaque family-audit-event envelopes. Mirrors
-- migration 0025's protection_alerts table shape exactly (same append-only,
-- no-acknowledge/decrypt/plaintext-read contract, same idempotent-by-id
-- record() semantics) -- this is the same accepted pattern, applied to a
-- different event source (FamilyAuditService.record(), not device-reported
-- protection-status transitions). Stores only opaque ciphertext and typed
-- routing metadata (family/parent-device/key-epoch), never a readable
-- actionType/targetScope/reasonCategory value -- those fields are encrypted
-- into encrypted_payload_b64 by FamilyAuditEventProducer before this table
-- ever sees them. See
-- docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md's
-- AUDIT_EVENT_MODEL section: FamilyAuditStore.ts's own doc comment requires
-- this to never become a plaintext server audit log.

CREATE TABLE family_audit_events (
  envelope_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  parent_device_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  key_epoch INT UNSIGNED NOT NULL,
  generated_at_utc DATETIME(3) NOT NULL,
  encrypted_payload_b64 MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce_b64 VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (envelope_id),
  KEY family_audit_events_family_idx (family_id, generated_at_utc),
  KEY family_audit_events_parent_device_idx (family_id, parent_device_id, generated_at_utc),
  CONSTRAINT family_audit_events_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT family_audit_events_parent_device_id_check CHECK (CHAR_LENGTH(parent_device_id) BETWEEN 1 AND 200),
  CONSTRAINT family_audit_events_key_epoch_check CHECK (key_epoch >= 0),
  CONSTRAINT family_audit_events_payload_check CHECK (CHAR_LENGTH(encrypted_payload_b64) BETWEEN 1 AND 4194304),
  CONSTRAINT family_audit_events_nonce_check CHECK (CHAR_LENGTH(nonce_b64) BETWEEN 1 AND 64)
) ENGINE=InnoDB;
