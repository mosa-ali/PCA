-- PCA action idempotency ledger (source-only, pre-production).
--
-- WHAT THIS IS. doc 18 Section 3: every parent action carries a "unique action
-- ID and idempotency key". This table is the durable home of the
-- APPLICATION-level exactly-once-AUTHORIZATION guarantee owned by
-- familyrbac/ParentActionAuthorizationService -- deliberately NOT the
-- wire-level anti-replay/ordering that familyenvelope's ReplayLedger or a
-- future PCA-11 transport owns. A legitimate retry of the SAME
-- (scope, idempotencyKey) must return the SAME prior authorization outcome
-- rather than being re-evaluated, because the trust-set state that produced it
-- may have changed in between.
--
-- WHY IT IS DURABLE (PCA full assessment finding P1-04, Wave 1). The
-- in-memory reference implementation lost every recorded authorization on
-- restart and was per-process, so a restart re-opened the replay window and a
-- multi-instance deployment gave each process its own protection. Neither is
-- acceptable for replay protection that guards authorization outcomes.
--
-- WHY (scope, idempotency_key) IS THE KEY, NOT idempotency_key ALONE. `scope`
-- is the opaque owner namespace the key must never collide across -- the
-- acting family_id for parent actions, and a fixed platform scope for the
-- unrelated model-emergency-directive caller that reuses this ledger. Without
-- it, two families could share one key space: one family's write could displace
-- another's record, and a family could evict another family's replay
-- protection by guessing keys. Same discipline as migration 0004's
-- (family_id, message_id) key on envelope_message_idempotency_ledger, and for
-- the same reason.
--
-- WHY THERE IS NO FOREIGN KEY ON scope. It is intentionally NOT a family_id
-- column: the same table also holds the platform-wide emergency-directive
-- scope, which belongs to no family. A FK would make that caller
-- unrepresentable. Scope membership is bounded at the application layer by the
-- only two writers, both of which derive it from already-authenticated
-- identity (a verified session's family, or the platform directive processor).
--
-- PRIVACY. No personal data, no family content and no activity payload is
-- stored here. `outcome` is the caller's opaque serialized AuthorizationDecision
-- -- a verdict plus a closed-vocabulary deny reason -- and `action_id`,
-- `idempotency_key` and `request_fingerprint` are identifiers/hashes. This is
-- intentionally NOT the family-local/E2EE family-audit store (see
-- familyrbac/FamilyAuditStore.ts and PCA-SEC-023): no free text, no note, no
-- child or parent content can reach this table, which is why a readable
-- server-side table is permitted here and is not permitted for that store.
--
-- IDEMPOTENCY (PCA full assessment finding P1-07). scripts/migrate.mjs records
-- a migration as applied only after it succeeds, so a crash between MySQL
-- auto-committing this statement and the schema_migrations row being written
-- would leave the table present but unrecorded, and a retry would fail with
-- "table already exists". `IF NOT EXISTS` makes that retry a no-op, exactly as
-- the resumability gate requires.
--
-- Production execution is a later owner-authorized gate; production is still
-- behind this migration.
CREATE TABLE IF NOT EXISTS action_idempotency_ledger (
  scope VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  action_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- NULL for callers that never populate it (ModelLifecycleService's directive
  -- replay), sha256 hex for the ones that do. Never a raw value.
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Opaque, caller-defined serialized AuthorizationDecision. TEXT, not a
  -- bounded VARCHAR: the column deliberately imposes no shape on a value the
  -- ledger is not allowed to interpret, and its size is bounded in code by the
  -- fixed two-field decision it is handed.
  outcome TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (scope, idempotency_key),
  -- Supports the capacity trim (oldest-first), which is the only query that
  -- does not go through the primary key.
  KEY action_idempotency_ledger_created_at_idx (created_at),
  CONSTRAINT action_idempotency_ledger_scope_check CHECK (char_length(scope) between 1 and 128),
  CONSTRAINT action_idempotency_ledger_key_check CHECK (char_length(idempotency_key) between 1 and 128),
  CONSTRAINT action_idempotency_ledger_action_id_check CHECK (char_length(action_id) between 1 and 128),
  CONSTRAINT action_idempotency_ledger_fingerprint_check CHECK (request_fingerprint IS NULL OR request_fingerprint REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB;
