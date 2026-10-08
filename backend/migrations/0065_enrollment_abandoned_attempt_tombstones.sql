-- Preserve recovery for an abandoned enrollment attempt after the invitation
-- claim row is reused by a later attempt. The tombstone contains only the
-- opaque attempt/invitation identifiers and a recovery-token hash; no result
-- or raw credential is stored.

CREATE TABLE IF NOT EXISTS enrollment_bootstrap_attempt_tombstones (
  attempt_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invitation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recovery_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  abandoned_at DATETIME(3) NOT NULL,
  PRIMARY KEY (attempt_id),
  KEY enrollment_bootstrap_attempt_tombstones_invitation_idx (invitation_id),
  CONSTRAINT enrollment_bootstrap_attempt_tombstones_attempt_id_check
    CHECK (CHAR_LENGTH(attempt_id) BETWEEN 16 AND 64),
  CONSTRAINT enrollment_bootstrap_attempt_tombstones_recovery_hash_check
    CHECK (recovery_token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT enrollment_bootstrap_attempt_tombstones_invitation_fk
    FOREIGN KEY (invitation_id) REFERENCES enrollment_invitations (invitation_id)
);
