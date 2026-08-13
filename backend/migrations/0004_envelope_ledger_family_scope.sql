-- PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: closes a cross-family
-- isolation gap in the three acceptance ledgers migration 0002 created
-- WITHOUT family scoping (envelope_replay_ledger, envelope_data_version_ledger,
-- envelope_message_idempotency_ledger). Only sync_sequence_progress_ledger
-- (also 0002) was ever correctly scoped by (family_id, sender_key_id) --
-- this migration brings the other three up to the SAME posture, not a new
-- one, matching precedent already established in this schema.
--
-- THE GAP: without a family_id column, every one of these three tables was
-- keyed GLOBALLY (message_id alone; sender_key_id alone;
-- sender_key_id+sequence_or_nonce). Nothing at the acceptance boundary
-- (backend/src/familyenvelope/FamilyEnvelopeVerifier.ts's evaluateEnvelope,
-- called from backend/src/familysync/SyncCoordinator.ts) cross-checked the
-- envelope's OWN self-declared familyId field against any authoritative,
-- session-derived family identity -- see runtimeSyncRoutes.ts's
-- requireDeviceSession, which already resolves request.runtimeSyncFamilyId
-- from a verified session token but, until this lane, that value was never
-- threaded into EnvelopeAcceptanceContext or compared against
-- envelope.familyId at all. Combined with these three tables' lack of
-- family scoping, two distinct devices in two DIFFERENT families whose
-- senderKeyId or messageId values ever collided (accidentally, or via a
-- malicious/compromised family-A device self-declaring familyId as family
-- B in its envelope) would share replay/version/idempotency ledger rows
-- across families -- e.g. family A's replayed nonce could be silently
-- masked as "already processed" by family B's unrelated traffic, or a
-- message-id conflict from family B could clobber family A's accepted
-- canonical bytes. This migration removes the possibility of that
-- collision at the schema level: acceptance state can no longer be shared
-- across two different family_id values, full stop, regardless of what any
-- application-layer check does or fails to do above it (defense in depth
-- -- the application-layer fix, an authoritative-familyId check in
-- FamilyEnvelopeVerifier/SyncCoordinator, is the primary fix and lives in
-- this same lane's src/ changes, not in this migration).
--
-- PRIVACY BOUNDARY (unchanged from 0001/0002): family_id is the same
-- opaque, bounded application identifier already approved for
-- sync_sequence_progress_ledger.family_id in 0002 -- not readable family
-- content. See backend/test/db/schema-privacy.mysql.test.mjs and
-- backend/test/schema-privacy.test.mjs, both unchanged by this migration
-- (no new prohibited term is introduced).
--
-- BOUNDING/EVICTION STRATEGY -- reconsidered per-table, not carried over
-- blindly:
--  * envelope_replay_ledger: eviction narrows from "per sender_key_id
--    globally" to "per (family_id, sender_key_id)" -- MySqlReplayLedger's
--    trimIfOverCapacity now filters by both columns. This is a genuine,
--    deliberate strengthening, not just a schema formality: capping
--    per-sender-only, once rows are family-scoped, would let one family's
--    heavy traffic for a given sender_key_id evict another (legitimately
--    distinct, if senderKeyId were ever reused) family's replay entries
--    for that same key -- a liveness/anti-replay-window regression this
--    migration is not willing to introduce even as a side effect.
--  * envelope_data_version_ledger: primary key becomes
--    (family_id, sender_key_id) -- exactly one row per family+sender pair
--    ever seen, same "no additional eviction needed" reasoning 0002 gave
--    for the un-scoped version (bounded by distinct sender-key population,
--    not message volume), just now correctly partitioned per family too.
--  * envelope_message_idempotency_ledger: eviction stays GLOBAL (not
--    narrowed to per-family) -- per 0002's own header, this was already a
--    resource-abuse ceiling, never a security control (messageId
--    uniqueness/conflict detection is the security property, and that is
--    exactly what the new (family_id, message_id) unique key now correctly
--    enforces per-family). Narrowing eviction to per-family here would only
--    change how soon the SAME shared global capacity budget is divided
--    across active families, a capacity-planning question, not a
--    correctness one -- left as global, matching 0002's stated intent
--    unless/until a real multi-tenant capacity incident says otherwise.

ALTER TABLE envelope_replay_ledger
  ADD COLUMN family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL AFTER id,
  ADD CONSTRAINT envelope_replay_ledger_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  DROP KEY envelope_replay_ledger_sender_sequence_key,
  DROP KEY envelope_replay_ledger_sender_id_idx,
  ADD UNIQUE KEY envelope_replay_ledger_family_sender_sequence_key (family_id, sender_key_id, sequence_or_nonce),
  ADD KEY envelope_replay_ledger_family_sender_id_idx (family_id, sender_key_id, id);

ALTER TABLE envelope_data_version_ledger
  ADD COLUMN family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL AFTER sender_key_id,
  ADD CONSTRAINT envelope_data_version_ledger_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (family_id, sender_key_id);

ALTER TABLE envelope_message_idempotency_ledger
  ADD COLUMN family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL AFTER id,
  ADD CONSTRAINT envelope_message_idempotency_ledger_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  DROP KEY envelope_message_idempotency_ledger_message_id_key,
  ADD UNIQUE KEY envelope_message_idempotency_ledger_family_message_key (family_id, message_id);
