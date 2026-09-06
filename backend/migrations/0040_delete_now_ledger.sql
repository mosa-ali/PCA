-- PCA-DW-W3-D -- durable persistence for retention/DeleteNowLedger.ts's
-- idempotency contract (doc 11 Section 6 + PCA-11 brief Section 23:
-- "Delete now" must be idempotent -- repeated invocation with the SAME
-- actionId produces the SAME final state and never re-runs the destructive
-- side effect). Previously in-memory only: a backend restart between an
-- original Delete-Now call and a client's retried/duplicated call would
-- lose the record of the action having already run, letting the retry
-- recompute and re-apply a (still-idempotent-in-effect, since planDeleteNow
-- is itself deterministic over the CURRENT record set) but no-longer-
-- identical purge plan against whatever data exists at retry time --
-- exactly the replay-safety gap this ledger exists to close.
--
-- `purge_plan` is the JSON-serialized PurgePlan (backend/src/retention/
-- engine.ts): entityClass/id/reason enums plus a localized presentation
-- string -- bookkeeping metadata about WHICH ALREADY-OPAQUE ENTITY IDS a
-- purge plan named and why, never a readable child content payload of any
-- kind (mirrors platform_admin_settings.value_json / audit_events.
-- metadata_json's already-accepted OPERATIONAL_METADATA class, migrations
-- 0026/0025).
CREATE TABLE delete_now_ledger (
  action_id VARCHAR(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  purge_plan JSON NOT NULL,
  completed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (action_id),
  CONSTRAINT delete_now_ledger_action_id_check CHECK (CHAR_LENGTH(action_id) BETWEEN 1 AND 300)
) ENGINE=InnoDB;
