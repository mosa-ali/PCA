-- PCA-ADD-ENR-012/016/017/018/020: consolidate the two previously
-- independent, never-composed removal/disable decision authorities
-- (enrollment/ProtectionApprovalService.ts and
-- familyrbac/RemovalDecisionService.ts) into one durable decision record.
--
-- 0022 already created `enrollment_protection_approval_requests` with the
-- PARENT_APPROVAL_REQUIRED/KEEP_ACTIVE/TEMPORARILY_DISABLE/ALLOW_REMOVAL
-- state vocabulary and the REMOTE_PARENT/LOCAL_ADMINISTRATION_PIN/
-- AUTHORIZED_RECOVERY decision-method vocabulary. This migration adds the
-- columns needed to also durably persist the signed-remote-parent mode's
-- exact request/action binding (folded in from RemovalDecisionService,
-- which previously only had an in-memory repository): the deciding
-- device, the signed action id, the idempotency key, and a fingerprint of
-- the signed decision's canonical binding (never the raw signature).

ALTER TABLE enrollment_protection_approval_requests
  ADD COLUMN decided_by_device_id VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER temporary_disable_until,
  ADD COLUMN decision_action_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER decided_by_device_id,
  ADD COLUMN idempotency_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER decision_action_id,
  ADD COLUMN decision_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER idempotency_key,
  ADD CONSTRAINT enrollment_protection_approval_decided_device_check CHECK (decided_by_device_id IS NULL OR CHAR_LENGTH(decided_by_device_id) BETWEEN 1 AND 200),
  ADD CONSTRAINT enrollment_protection_approval_decision_action_check CHECK (decision_action_id IS NULL OR CHAR_LENGTH(decision_action_id) BETWEEN 1 AND 128),
  ADD CONSTRAINT enrollment_protection_approval_idempotency_check CHECK (idempotency_key IS NULL OR CHAR_LENGTH(idempotency_key) BETWEEN 1 AND 128),
  ADD CONSTRAINT enrollment_protection_approval_fingerprint_check CHECK (decision_fingerprint IS NULL OR CHAR_LENGTH(decision_fingerprint) = 64);

-- A signed action id can be replayed by a legitimate idempotent retry (same
-- committed decision), but never applied twice to two DIFFERENT requests --
-- the repository's compare-and-set already enforces "only from
-- PARENT_APPROVAL_REQUIRED", and this unique index closes the remaining gap
-- where two distinct rows could otherwise carry the same signed action id.
CREATE UNIQUE INDEX enrollment_protection_approval_decision_action_uq
  ON enrollment_protection_approval_requests (decision_action_id);
