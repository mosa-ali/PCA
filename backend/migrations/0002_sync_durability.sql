-- PCA-SYNC-DURABILITY-1: durable backing for the family-sync/family-envelope
-- security ledgers that were, until this migration, only ever implemented
-- as process-memory Maps (InMemoryReplayLedger, InMemoryDataVersionLedger,
-- InMemoryMessageIdempotencyLedger, InMemorySequenceProgressLedger). A
-- backend-process restart previously reset every one of these to empty,
-- which is a genuine anti-replay / anti-downgrade / idempotency regression
-- once a reviewed EnvelopeSignatureVerifier eventually replaces
-- RejectingEnvelopeSignatureVerifier (src/runtime-sync/RejectingCryptoVerifiers.ts,
-- unchanged by this migration -- envelope acceptance remains fully
-- fail-closed today). This migration adds ONLY the durable replacement
-- tables for the four ledgers that gate acceptance/replay/ordering
-- decisions; PendingQueueStore (src/familysync/PendingQueueStore.ts) and
-- DeviceSessionRepository (src/runtime-sync/DeviceSessionRepository.ts)
-- are deliberately NOT persisted here -- see each interface's own
-- InMemory* class doc comment (DeviceSessionRepository's is explicit:
-- "losing a session on restart only costs a cheap re-authentication,
-- never data") and PCA-SYNC-DURABILITY-1's own report for the reasoning:
-- losing a held/dependency-gated pending envelope on restart is a
-- liveness/availability cost (the sender's own reconnect/resubmit path is
-- the documented convergence mechanism -- see SyncCoordinator.ts), never a
-- security regression, because a promoted pending candidate is ALWAYS
-- re-run through the full acceptance pipeline (including every ledger
-- below) before being applied -- it is never pre-trusted.
--
-- PRIVACY BOUNDARY (unchanged from 0001_mysql_baseline.sql): every column
-- here is opaque application/protocol metadata -- sender key ids, message
-- ids, sequence/nonce strings, and semantic version numbers, all already
-- bounded/opaque per src/familyenvelope/policy.ts -- or an opaque signed
-- envelope's canonical bytes stored as MEDIUMBLOB, exactly the same
-- ciphertext-blind posture as relay_envelopes.ciphertext /
-- recovery_envelopes.ciphertext / release_packages.signed_metadata. No
-- readable family content, policy content, location, usage, or plaintext
-- payload is ever stored. See backend/test/db/schema-privacy.mysql.test.mjs
-- and backend/test/schema-privacy.test.mjs for the enforced guard.
--
-- BOUNDING / CLEANUP STRATEGY: matches each in-memory implementation's own
-- bounding strategy exactly (this is a drop-in replacement, not a new
-- policy) --
--  * envelope_replay_ledger: bounded per sender_key_id at
--    REPLAY_LEDGER_CAPACITY_PER_SENDER (src/familyenvelope/policy.ts),
--    oldest-by-insertion-order evicted once a sender's cap is reached --
--    see MySqlReplayLedger.recordProcessed's trim step.
--  * envelope_message_idempotency_ledger: bounded GLOBALLY at
--    MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY, same oldest-first eviction --
--    see MySqlMessageIdempotencyLedger.recordAccepted's trim step.
--  * envelope_data_version_ledger / sync_sequence_progress_ledger: exactly
--    one row per (sender_key_id) / (family_id, sender_key_id) pair ever
--    seen -- bounded by the population of distinct sender keys actually in
--    use (proportional to device count), not by message volume, so no
--    additional eviction is needed (identical to the in-memory Maps, which
--    also never bounded these two).

CREATE TABLE envelope_replay_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_key_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  sequence_or_nonce VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY envelope_replay_ledger_sender_sequence_key (sender_key_id, sequence_or_nonce),
  KEY envelope_replay_ledger_sender_id_idx (sender_key_id, id),
  CONSTRAINT envelope_replay_ledger_sender_key_id_check CHECK (CHAR_LENGTH(sender_key_id) BETWEEN 1 AND 128),
  CONSTRAINT envelope_replay_ledger_sequence_or_nonce_check CHECK (CHAR_LENGTH(sequence_or_nonce) BETWEEN 1 AND 128)
) ENGINE=InnoDB;

CREATE TABLE envelope_data_version_ledger (
  sender_key_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  last_accepted_version VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (sender_key_id),
  CONSTRAINT envelope_data_version_ledger_sender_key_id_check CHECK (CHAR_LENGTH(sender_key_id) BETWEEN 1 AND 128),
  CONSTRAINT envelope_data_version_ledger_version_check
    CHECK (last_accepted_version REGEXP '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$')
) ENGINE=InnoDB;

CREATE TABLE envelope_message_idempotency_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- Opaque canonical envelope bytes (see src/familyenvelope/canonicalize.ts)
  -- -- includes the envelope's authenticated-encrypted payload, base64-
  -- encoded, alongside already-permitted structural/opaque metadata
  -- (message type, sender/device ids, epochs, version). Never decrypted,
  -- parsed, or indexed here -- MEDIUMBLOB, same posture as every other
  -- opaque/ciphertext column in this schema.
  canonical_bytes MEDIUMBLOB NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY envelope_message_idempotency_ledger_message_id_key (message_id),
  CONSTRAINT envelope_message_idempotency_ledger_message_id_check CHECK (CHAR_LENGTH(message_id) BETWEEN 1 AND 128)
) ENGINE=InnoDB;

CREATE TABLE sync_sequence_progress_ledger (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  sender_key_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  last_applied_sequence BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (family_id, sender_key_id),
  CONSTRAINT sync_sequence_progress_ledger_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT sync_sequence_progress_ledger_sender_key_id_check CHECK (CHAR_LENGTH(sender_key_id) BETWEEN 1 AND 128)
) ENGINE=InnoDB;
