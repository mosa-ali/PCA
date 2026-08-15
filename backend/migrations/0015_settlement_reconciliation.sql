-- PCA-BILL-3 (Writer62, Round6): Settlement / Reconciliation
-- (SETTLEMENT_RECONCILIATION_V1, ROUND6_INTERFACE_CONTRACTS.md). Closes the
-- confirmed, fully-absent gap: SettlementAccount, SettlementBatch,
-- Reconciliation had ZERO source anywhere prior to this migration -- only
-- the reserved `ADMINISTER_SETTLEMENT` RBAC operation name
-- (platformadmin/auth/rbacPolicy.ts) and the reserved
-- `SETTLEMENT_BANK_CONFIG` step-up scope (platformadmin/auth/types.ts)
-- existed as placeholders. Provider-neutral, no SDK binding, no live bank
-- connection.
--
-- PAYMENT SECURITY (matching `billing_payment_methods`'s exact precedent,
-- migration 0007's own header note): `settlement_accounts.provider_ref` and
-- `settlement_batches.provider_ref` are OPAQUE, secret-resolver-indirection
-- references (billing/provider/secretResolver.ts's existing pattern) --
-- never a raw banking credential, password, PIN, API key, or private key.
-- `display_label` is a masked/display-safe string only (e.g. "****1234").
-- No column in this migration can ever hold an unmasked banking secret --
-- see backend/test/db/settlementSchemaPrivacy.mysql.test.mjs's grep-based
-- absence assertions against this file's own DDL, the same discipline
-- billingCoreSchemaPrivacy.mysql.test.mjs already applies to
-- migration 0007.
--
-- ORIGINAL PAYMENT TRUTH NEVER MUTATED: `settlement_batch_items` only ever
-- associates an existing, immutable `billing_payment_transactions` row
-- (migration 0007) to exactly one settlement batch -- no column here is
-- ever written back onto that table, and no trigger/foreign-key ON UPDATE
-- CASCADE exists that could do so implicitly.
--
-- DOUBLE-ATTRIBUTION PREVENTION: `settlement_batch_items_transaction_key`
-- is a UNIQUE KEY on `payment_transaction_id` alone (not a composite with
-- batch id) -- this is the actual database-authoritative guarantee that a
-- given PaymentTransaction can be attributed to AT MOST one batch, ever,
-- enforced even under concurrent INSERTs from independent connections
-- (InnoDB's unique-index insert conflict is resolved by the storage engine
-- itself, not by application-level locking) -- see
-- backend/src/billing/settlement/MySqlSettlementRepository.ts's
-- attributeTransaction, which relies on this constraint (via
-- isDuplicateEntry, db/pool.ts) rather than a SELECT-then-INSERT race.
--
-- FX SNAPSHOT IMMUTABILITY: `settlement_fx_snapshots` has no UPDATE path
-- anywhere in this lane's repository -- once inserted (1:1 with a batch
-- item, enforced by `settlement_fx_snapshots_item_key`), a recorded rate is
-- permanent. `recorded_rate` is an exact fixed-point DECIMAL, never a
-- FLOAT/DOUBLE column, and no application code ever live-fetches a rate to
-- populate it -- see SettlementService.recordFxSnapshot's doc comment.
--
-- RECONCILIATION STATE MACHINE: `settlement_batches.status` starts
-- 'MATCHED' or 'UNDER_INVESTIGATION' (computed once at batch-close time
-- from exact bigint `difference_minor = received_minor - net_minor`
-- arithmetic -- never float) and only ever transitions
-- UNDER_INVESTIGATION -> RESOLVED via a single conditional
-- `UPDATE ... WHERE status = 'UNDER_INVESTIGATION'` (mirroring
-- `complimentary_entitlement_grants`'s `WHERE status = 'ACTIVE'`
-- conditional-update convention, migration 0014) -- concurrent resolution
-- attempts race on that WHERE clause; exactly one wins.
-- `resolution_reason`/`resolved_by_admin_id`/`resolved_at` are populated
-- together, only on that transition, enforced by
-- `settlement_batches_resolution_pair_check`. A batch already MATCHED at
-- close time has nothing to resolve (RESOLVE_RECONCILIATION on a MATCHED
-- batch is rejected at the service layer, never silently accepted here).
--
-- This migration introduces 4 new tables and ADDITIVELY widens migration
-- 0005's `platform_admin_audit_events_event_type_check` CHECK constraint
-- (every previously-accepted value preserved verbatim) to admit this
-- lane's new audit event types -- no existing 0005 column/table/scope is
-- otherwise touched. `SETTLEMENT_BANK_CONFIG` (already an accepted
-- `platform_admin_step_up_sessions.scope` value since migration 0005) is
-- REUSED as-is for every settlement mutation's step-up requirement -- this
-- migration does not touch that CHECK constraint at all.

-- ---------------------------------------------------------------------------
-- 1. settlement_accounts
-- ---------------------------------------------------------------------------
CREATE TABLE settlement_accounts (
  settlement_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_ref VARCHAR(128) NOT NULL,
  display_label VARCHAR(64) NOT NULL,
  settlement_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (settlement_account_id),
  KEY settlement_accounts_status_idx (status),
  CONSTRAINT settlement_accounts_currency_fk FOREIGN KEY (settlement_currency) REFERENCES billing_currencies (currency_code),
  CONSTRAINT settlement_accounts_provider_ref_check CHECK (CHAR_LENGTH(provider_ref) BETWEEN 1 AND 128),
  CONSTRAINT settlement_accounts_display_label_check CHECK (CHAR_LENGTH(display_label) BETWEEN 1 AND 64),
  CONSTRAINT settlement_accounts_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 2. settlement_batches
-- ---------------------------------------------------------------------------
-- All monetary columns are exact BIGINT minor-unit amounts, paired with the
-- batch's single `settlement_currency` (billing/money.ts's Money contract:
-- amountMinor + explicit currencyCode, never a bare unqualified amount) --
-- expected_gross/fees/net/received/difference are all denominated in this
-- SAME currency (cross-currency source transactions are converted via a
-- settlement_fx_snapshots row per item BEFORE being summed into these
-- batch-level totals; the batch itself never mixes currencies).
CREATE TABLE settlement_batches (
  settlement_batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_account_ref CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_start DATETIME(3) NOT NULL,
  period_end DATETIME(3) NOT NULL,
  expected_gross_minor BIGINT NOT NULL,
  fees_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  received_minor BIGINT NOT NULL,
  difference_minor BIGINT NOT NULL,
  status VARCHAR(24) NOT NULL,
  provider_ref VARCHAR(128) NOT NULL,
  resolution_reason VARCHAR(500) NULL,
  resolved_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolved_at DATETIME(3) NULL,
  created_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (settlement_batch_id),
  KEY settlement_batches_account_ref_idx (settlement_account_ref),
  KEY settlement_batches_status_idx (status),
  KEY settlement_batches_period_idx (period_start, period_end),
  CONSTRAINT settlement_batches_account_fk FOREIGN KEY (settlement_account_ref) REFERENCES settlement_accounts (settlement_account_id),
  CONSTRAINT settlement_batches_currency_fk FOREIGN KEY (settlement_currency) REFERENCES billing_currencies (currency_code),
  CONSTRAINT settlement_batches_created_by_fk FOREIGN KEY (created_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT settlement_batches_resolved_by_fk FOREIGN KEY (resolved_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT settlement_batches_provider_ref_check CHECK (CHAR_LENGTH(provider_ref) BETWEEN 1 AND 128),
  CONSTRAINT settlement_batches_period_check CHECK (period_end > period_start),
  CONSTRAINT settlement_batches_status_check CHECK (status IN ('MATCHED', 'UNDER_INVESTIGATION', 'RESOLVED')),
  -- difference_minor is always exactly received_minor - net_minor -- this
  -- CHECK is a belt-and-suspenders proof alongside the application-layer
  -- exact-bigint-arithmetic computation (SettlementService.closeBatch);
  -- amounts are non-negative except difference, which may be negative
  -- (received short of net) and is intentionally SIGNED (BIGINT, not
  -- BIGINT UNSIGNED).
  CONSTRAINT settlement_batches_difference_check CHECK (difference_minor = received_minor - net_minor),
  CONSTRAINT settlement_batches_amounts_nonneg_check CHECK (expected_gross_minor >= 0 AND fees_minor >= 0 AND net_minor >= 0 AND received_minor >= 0),
  -- RESOLVED requires reason + actor + timestamp together; MATCHED/
  -- UNDER_INVESTIGATION must have none of the three (a batch is never
  -- "half-resolved").
  CONSTRAINT settlement_batches_resolution_pair_check CHECK (
    (status = 'RESOLVED' AND resolution_reason IS NOT NULL AND resolved_by_admin_id IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status <> 'RESOLVED' AND resolution_reason IS NULL AND resolved_by_admin_id IS NULL AND resolved_at IS NULL)
  )
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 3. settlement_batch_items
-- ---------------------------------------------------------------------------
-- Associates an existing, immutable billing_payment_transactions row to
-- exactly one settlement batch. `settlement_batch_items_transaction_key` is
-- the double-attribution guard (see file header). `amount_minor`/
-- `currency_code` are copied from the source PaymentTransactionRow at
-- attribution time (an immutable snapshot for this item's own accounting,
-- exactly like billing_payment_attempts snapshots a PriceSnapshot,
-- migration 0007) -- never a live join back to
-- billing_payment_transactions for a later read.
CREATE TABLE settlement_batch_items (
  settlement_batch_item_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_transaction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (settlement_batch_item_id),
  -- The double-settlement guard: AT MOST one batch item may ever reference
  -- a given payment_transaction_id, across ALL batches, for all time.
  UNIQUE KEY settlement_batch_items_transaction_key (payment_transaction_id),
  KEY settlement_batch_items_batch_idx (settlement_batch_id),
  CONSTRAINT settlement_batch_items_batch_fk FOREIGN KEY (settlement_batch_id) REFERENCES settlement_batches (settlement_batch_id),
  CONSTRAINT settlement_batch_items_transaction_fk FOREIGN KEY (payment_transaction_id) REFERENCES billing_payment_transactions (payment_transaction_id),
  CONSTRAINT settlement_batch_items_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT settlement_batch_items_amount_check CHECK (amount_minor >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 4. settlement_fx_snapshots
-- ---------------------------------------------------------------------------
-- Only present when a batch item's source currency differs from the
-- batch's settlement currency. 1:1 with a settlement_batch_item (enforced
-- by the UNIQUE key), immutable once inserted -- no UPDATE statement
-- against this table exists anywhere in this lane's repository code.
-- `recorded_rate` is a fixed-point DECIMAL(24,10) -- exact, never a
-- FLOAT/DOUBLE -- and is a manually-entered/administrator-recorded value
-- at batch-authoring time, never a live-fetched external rate.
CREATE TABLE settlement_fx_snapshots (
  settlement_fx_snapshot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_batch_item_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  settlement_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recorded_rate DECIMAL(24, 10) NOT NULL,
  effective_timestamp DATETIME(3) NOT NULL,
  provider_ref VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (settlement_fx_snapshot_id),
  UNIQUE KEY settlement_fx_snapshots_item_key (settlement_batch_item_id),
  CONSTRAINT settlement_fx_snapshots_item_fk FOREIGN KEY (settlement_batch_item_id) REFERENCES settlement_batch_items (settlement_batch_item_id),
  CONSTRAINT settlement_fx_snapshots_source_currency_fk FOREIGN KEY (source_currency) REFERENCES billing_currencies (currency_code),
  CONSTRAINT settlement_fx_snapshots_settlement_currency_fk FOREIGN KEY (settlement_currency) REFERENCES billing_currencies (currency_code),
  CONSTRAINT settlement_fx_snapshots_rate_check CHECK (recorded_rate > 0),
  CONSTRAINT settlement_fx_snapshots_currency_pair_check CHECK (source_currency <> settlement_currency),
  CONSTRAINT settlement_fx_snapshots_provider_ref_check CHECK (CHAR_LENGTH(provider_ref) BETWEEN 1 AND 128)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 5. Additive widening of migration 0005's closed audit event_type vocabulary
-- ---------------------------------------------------------------------------
-- 5 new audit event types this lane emits, added to the existing
-- platform_admin_audit_events_event_type_check list (every previously-
-- accepted value preserved verbatim). Mirrors
-- backend/src/platformadmin/audit/types.ts's
-- PLATFORM_ADMIN_AUDIT_EVENT_TYPES -- a reviewer changing one MUST change
-- the other (same anchor discipline migration 0014 already established).
ALTER TABLE platform_admin_audit_events
  DROP CHECK platform_admin_audit_events_event_type_check,
  ADD CONSTRAINT platform_admin_audit_events_event_type_check CHECK (event_type IN (
    'ADMIN_LOGIN', 'ADMIN_LOGIN_FAILED', 'ADMIN_CREATED', 'ADMIN_ROLE_CHANGED',
    'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED', 'DEVICE_LIMIT_CHANGED',
    'LIMIT_REQUEST_APPROVED', 'LIMIT_REQUEST_DENIED', 'PLAN_CHANGED',
    'PAYMENT_REFUNDED', 'BANK_SETTING_CHANGED', 'SETTING_CHANGED',
    'PRICE_BOOK_CHANGED', 'QUOTE_ISSUED', 'PAYMENT_CONFIRMED',
    'ENTITLEMENT_INCREASED', 'PAYMENT_ROLLED_BACK',
    'ADMIN_SESSION_REVOKED', 'ADMIN_LOGIN_LOCKED_OUT',
    'ADMIN_STEP_UP_GRANTED', 'ADMIN_STEP_UP_DENIED', 'ADMIN_MFA_ENROLLED',
    'COMPLIMENTARY_GRANT_CREATED', 'COMPLIMENTARY_GRANT_CHANGED',
    'COMPLIMENTARY_GRANT_REVOKED', 'COMPLIMENTARY_GRANT_EXPIRED',
    'SETTLEMENT_ACCOUNT_CREATED', 'SETTLEMENT_ACCOUNT_CHANGED',
    'SETTLEMENT_BATCH_CREATED', 'SETTLEMENT_BATCH_ITEM_ATTRIBUTED',
    'SETTLEMENT_RECONCILIATION_RESOLVED'
  ));
