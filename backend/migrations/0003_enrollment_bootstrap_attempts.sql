-- PCA-ENROLLMENT-RUNTIME-2: closes BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP.
--
-- PROBLEM: a child device sends a valid bootstrap request; the server
-- redeems the invitation and creates the device; the HTTP response is then
-- lost (crash, network drop, process restart) before the child learns its
-- deviceId. The ONLY authority for enrollment remains possession of the
-- one-time invitation token (unchanged) -- but the invitation is now
-- REDEEMED, so a naive retry with the same token collapses into the same
-- generic 404 invitation_unavailable used for a genuinely dead invitation,
-- and the child can never recover the deviceId it already (successfully)
-- created.
--
-- FIX: a durable, narrow mapping from one CLIENT-GENERATED, high-entropy,
-- NON-secret "bootstrap attempt id" to the single device that attempt ever
-- created, written atomically in the SAME transaction as invitation
-- redemption + device + DSK/DEK creation (see
-- MySqlEnrollmentCoordinatorRepository.enrollDevice). A retry that presents
-- the SAME (token, attemptId, DSK, DEK) tuple is recognized as the same
-- logical attempt and replays the original result -- it never redeems a
-- second time and never creates a second device. A recovery credential
-- (attemptRecoveryToken, a second high-entropy secret the CLIENT generates
-- and durably persists BEFORE sending the original request, exactly
-- mirroring how the client already generates and never-persists the raw
-- invitation token) lets the child recover the deviceId via a dedicated
-- endpoint even if it loses the in-memory response entirely and restarts --
-- without ever persisting the raw invitation token, and without the
-- (public, non-secret) attemptId alone being sufficient to read state.
--
-- NO EXISTENCE ORACLE: attemptId is not secret (an attacker may guess or
-- observe one), so by itself it must never disclose anything. Only
-- attemptRecoveryToken -- a 256-bit secret this table stores solely as a
-- SHA-256 hash, exactly like enrollment_invitations.token_hash -- proves the
-- caller recovering state is the same party that made the original
-- request. Row lookups by attemptId alone (the redemption-retry fast path)
-- only ever return data to a caller who ALSO already re-presents the
-- original invitation token and DSK/DEK -- i.e. who already had full
-- original-request authority, not merely knowledge of attemptId.
--
-- ATOMICITY: exactly one row is ever inserted per attempt_id, in the same
-- transaction as the device it names (see MySqlEnrollmentCoordinatorRepository).
-- There is no PENDING/in-flight row: if the transaction does not commit,
-- nothing is persisted here, and a retry of that (never-committed) attempt
-- simply runs the ordinary enrollment path again from scratch -- this table
-- only ever records completed, already-committed outcomes.
--
-- BACKWARD COMPATIBILITY: invitations redeemed before this migration existed
-- (PCA-ENROLLMENT-RUNTIME-1 and earlier) have no corresponding row here by
-- construction. A retry against such an invitation finds no matching
-- attempt row, falls through to the ordinary ALREADY_REDEEMED outcome, and
-- still collapses to the same generic invitation_unavailable response --
-- fail-safe, not newly enumerable, no behavior change for old rows.
--
-- PRIVACY BOUNDARY (unchanged from 0001/0002): every column is opaque
-- application/enrollment metadata (ids, hashes, public keys) already
-- permitted elsewhere in this schema (enrollment_invitations, devices,
-- device_public_keys). No activity/usage/location/policy/plaintext content.
-- No private key material -- signing_public_key/encryption_public_key are
-- the same PUBLIC key values already accepted into device_public_keys.

CREATE TABLE enrollment_bootstrap_attempts (
  -- Client-generated, high-entropy, NON-secret correlator for retries of one
  -- logical enrollment attempt. Not itself an authority: see the table
  -- comment above.
  attempt_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Which invitation this attempt redeemed. A retry that presents this same
  -- attempt_id together with a DIFFERENT token_hash is a conflicting reuse
  -- of the attempt id, not a legitimate replay -- see
  -- MySqlEnrollmentCoordinatorRepository's ATTEMPT_CONFLICT outcome.
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- SHA-256 of the client-generated attemptRecoveryToken secret. The raw
  -- value is never stored, exactly like enrollment_invitations.token_hash.
  recovery_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform VARCHAR(16) NOT NULL,
  -- Recorded so a retry/replay can be verified to present the SAME DSK/DEK
  -- (section 11: a retry must reuse keys, never mint new ones) rather than
  -- silently trusting attempt_id+token_hash alone.
  signing_public_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  encryption_public_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Denormalized copies of the two device_public_keys.key_id values this
  -- attempt registered, so a replay/recovery lookup can reconstruct the
  -- full original EnrollDeviceResult without an extra join.
  signing_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encryption_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invitation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- Reserved for future lifecycle (e.g. marking an attempt's device
  -- revoked); COMPLETED is the only value this migration ever writes -- see
  -- table comment: no PENDING/in-flight row is ever persisted.
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (attempt_id),
  UNIQUE KEY enrollment_bootstrap_attempts_recovery_token_hash_key (recovery_token_hash),
  KEY enrollment_bootstrap_attempts_token_hash_idx (token_hash),
  KEY enrollment_bootstrap_attempts_device_id_idx (device_id),
  CONSTRAINT enrollment_bootstrap_attempts_device_id_fk FOREIGN KEY (device_id) REFERENCES devices (device_id),
  CONSTRAINT enrollment_bootstrap_attempts_attempt_id_check CHECK (CHAR_LENGTH(attempt_id) BETWEEN 16 AND 64),
  CONSTRAINT enrollment_bootstrap_attempts_token_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT enrollment_bootstrap_attempts_recovery_token_hash_check CHECK (recovery_token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT enrollment_bootstrap_attempts_platform_check CHECK (platform IN ('ANDROID', 'IOS')),
  CONSTRAINT enrollment_bootstrap_attempts_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT enrollment_bootstrap_attempts_status_check CHECK (status IN ('COMPLETED'))
) ENGINE=InnoDB;
