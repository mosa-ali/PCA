-- PCA-BILL-2A-R1: payment orchestration correction. Introduces exactly one
-- new table, `billing_refund_operations`, closing the FIX 2 (refund
-- split-state) and FIX 3 (cumulative-refund concurrency race) gaps
-- identified in this lane's correction mission. No existing table
-- (0001-0007) is altered.
--
-- LANE BOUNDARY: this migration is owned exclusively by PCA-BILL-2A-R1, on
-- top of PCA-BILL-1's migration 0007 (billing_payment_transactions,
-- billing_refunds, billing_currencies) -- it does not alter any of those
-- tables, and follows migration 0007's own conventions exactly (explicit
-- BIGINT amount_minor beside an explicit currency_code, ASCII/binary
-- CHAR(36) ids, CHECK-constrained closed-vocabulary status columns, no
-- family-activity/policy/payment-instrument-secret column -- see
-- backend/test/billing/schemaPrivacy.test.mjs's extension for this table
-- and backend/test/db/billingCoreSchemaPrivacy.mysql.test.mjs's live
-- counterpart).
--
-- WHY THIS TABLE EXISTS (see backend/src/billing/refundOrchestration/RefundOrchestrationService.ts
-- for the full design rationale):
--   FIX 2 (durable refund intent): `billingRefundRoutes.ts` previously
--   called `provider.refund(...)` BEFORE any local row existed at all. If
--   the provider call succeeded and the subsequent `RefundService.issueRefund`
--   call then threw, money moved at the provider with ZERO durable local
--   trace. This table's `CREATED` row is now inserted (and, before the
--   provider is ever called, arbitrated against the transaction's
--   remaining refundable balance -- see FIX 3 below) FIRST, so a
--   provider-confirmed refund always has a durable local operation record
--   that can be reconciled/retried to `FINALIZED`, even if
--   `RefundService.issueRefund` itself fails after the provider already
--   confirmed (the row simply stays `PROVIDER_CONFIRMED`, never lost).
--
--   FIX 3 (cumulative-refund concurrency): `RefundService.issueRefund`'s
--   own cumulative-refund check (`sumRefundedForTransaction`, refund.ts, an
--   accepted PCA-BILL-1 file this lane does not edit) sums
--   `billing_refunds` inside a transaction but never locks the parent
--   `billing_payment_transactions` row first -- under real MySQL
--   concurrency (READ COMMITTED, this codebase's standard isolation level,
--   see db/pool.ts) two concurrent transactions can both read the same
--   "already refunded" sum before either commits, both pass the check, and
--   both insert (see backend/test/db/refundBalanceRaceConcurrency.mysql.test.mjs
--   for the real two-connection proof). This lane cannot edit refund.ts to
--   add a lock there, so the arbitration point is moved to THIS table
--   instead: `RefundOrchestrationService` takes a `SELECT ... FOR UPDATE`
--   lock on the existing `billing_payment_transactions` row (an existing
--   row lock genuinely serializes two concurrent transactions targeting
--   the SAME payment_transaction_id, even under READ COMMITTED -- the
--   second blocks until the first commits/rolls back) and re-sums
--   `billing_refund_operations` (CREATED/PROVIDER_CONFIRMED/FINALIZED)
--   for that transaction BEFORE inserting a new CREATED row, all inside
--   ONE transaction with the lock. Only an operation that passes this
--   real DB-arbitrated check is ever allowed to reach `provider.refund`.
--
-- `idempotency_key` (UNIQUE): the concurrency-safety and retry-recognition
-- primitive, following the EXACT SAME discipline as
-- billing_provider_events's UNIQUE(provider, provider_event_id)
-- (migration 0007) -- INSERT with this UNIQUE constraint as the SOLE
-- concurrency primitive for idempotent-replay detection, never a
-- pre-check-then-insert (TOCTOU) pattern. A duplicate-key error on this
-- column means "this exact logical refund request was already
-- initiated" -- the caller looks up and returns the existing row's state
-- instead of proceeding, exactly like ProviderEventRepository.recordIfNew.
--
-- `refund_id` is nullable until `RefundService.issueRefund` succeeds (state
-- transitions to FINALIZED) -- it is a genuine FOREIGN KEY reference into
-- the accepted `billing_refunds` table (that table is read-only to this
-- migration; no column of it is altered).
CREATE TABLE billing_refund_operations (
  refund_operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_transaction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(32) NOT NULL,
  reason_note VARCHAR(255) NULL,
  initiated_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  step_up_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  provider_refund_ref VARCHAR(128) NULL,
  state VARCHAR(20) NOT NULL,
  refund_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (refund_operation_id),
  UNIQUE KEY billing_refund_operations_idempotency_key (idempotency_key),
  KEY billing_refund_operations_transaction_idx (payment_transaction_id),
  CONSTRAINT billing_refund_operations_transaction_fk FOREIGN KEY (payment_transaction_id) REFERENCES billing_payment_transactions (payment_transaction_id),
  CONSTRAINT billing_refund_operations_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_refund_operations_admin_fk FOREIGN KEY (initiated_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT billing_refund_operations_step_up_fk FOREIGN KEY (step_up_session_id) REFERENCES platform_admin_step_up_sessions (step_up_id),
  CONSTRAINT billing_refund_operations_refund_fk FOREIGN KEY (refund_id) REFERENCES billing_refunds (refund_id),
  CONSTRAINT billing_refund_operations_state_check CHECK (state IN ('CREATED', 'PROVIDER_CONFIRMED', 'FINALIZED', 'FAILED')),
  CONSTRAINT billing_refund_operations_amount_check CHECK (amount_minor > 0),
  CONSTRAINT billing_refund_operations_reason_note_check CHECK (reason_note IS NULL OR CHAR_LENGTH(reason_note) <= 255)
) ENGINE=InnoDB;
