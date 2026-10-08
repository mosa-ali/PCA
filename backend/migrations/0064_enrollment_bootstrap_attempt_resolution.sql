-- PCA Parent enrollment attempt-resolution handshake.
--
-- PREPARED is persisted before a new client sends the bootstrap request.
-- A recovery request holding the attempt recovery secret serializes against
-- bootstrap on the invitation row: it returns the completed result, or
-- transitions PREPARED -> ABANDONED. A later bootstrap for an abandoned
-- attempt is rejected. A fresh attempt may replace the abandoned row only
-- after presenting the raw invitation token to the prepare endpoint.
--
-- The unique token_hash index is a compatibility backstop. Older backend
-- instances do not know about PREPARED, but they still insert an attempt
-- row in the same transaction as device creation. The unique index makes
-- that transaction roll back while a prepared claim exists, including an
-- old instance using a different attempt id. This prevents a mixed-version
-- fleet from bypassing the reservation.
--
-- Existing completed attempts retain their exact ids, keys, and references.
-- No row is deleted or backfilled. If historical duplicate invitation
-- hashes exist, the unique-index DDL fails without deleting or rewriting
-- them, and rollout must stop for explicit reconciliation.

ALTER TABLE enrollment_bootstrap_attempts
  DROP CHECK enrollment_bootstrap_attempts_status_check,
  MODIFY COLUMN device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY COLUMN signing_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY COLUMN encryption_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  DROP KEY enrollment_bootstrap_attempts_token_hash_idx,
  ADD UNIQUE KEY enrollment_bootstrap_attempts_token_hash_key (token_hash),
  ADD CONSTRAINT enrollment_bootstrap_attempts_status_check
    CHECK (status IN ('PREPARED', 'COMPLETED', 'ABANDONED')),
  ADD CONSTRAINT enrollment_bootstrap_attempts_device_result_check CHECK (
    (status = 'COMPLETED' AND device_id IS NOT NULL AND signing_key_id IS NOT NULL AND encryption_key_id IS NOT NULL)
    OR
    (status IN ('PREPARED', 'ABANDONED') AND device_id IS NULL AND signing_key_id IS NULL AND encryption_key_id IS NULL)
  );
