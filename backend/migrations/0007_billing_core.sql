-- PCA-BILL-1: Provider-independent Billing Core. Implements
-- docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md
-- Section 9 (billing domain entities), Section 10 (money model), and the
-- price-book versioning / quote-snapshot-immutability discipline
-- (`PCA-ADD-BILL-043`).
--
-- LANE BOUNDARY (binding, do not violate in any future edit to this file):
-- this migration is owned exclusively by PCA-BILL-1. It does not alter
-- 0001-0005, and it does not create or reference migration 0006
-- (`platform_entitlements_enrollment_limits`, Agent42's parallel,
-- uncommitted lane) in any way -- no table introduced here has a foreign
-- key to any table only 0006 would introduce. `increase_request_ref`
-- columns below are bounded opaque VARCHAR identifiers ONLY, never a
-- foreign key -- cross-domain existence validation of an entitlement
-- increase-request id is a later service/integration-time concern owned by
-- whichever lane administers entitlements, not this one (see
-- PCA-ADD-BILL contract note on each such column below).
--
-- MONEY MODEL (`PCA-ADD-BILL-017`/018): every monetary amount is an exact
-- BIGINT count of the currency's minor unit (`amount_minor`), paired with an
-- explicit `currency_code` -- never a FLOAT/DOUBLE/DECIMAL-as-float
-- approximation anywhere in this schema.
--
-- CURRENCY CENTRALIZATION (`PCA-ADD-BILL-018`/019): `billing_currencies` is
-- the single, centrally maintained currency-metadata table every other
-- billing table's `currency_code` column foreign-keys into -- no call site
-- anywhere hardcodes a currency's minor-unit exponent. It is seeded with
-- exactly the three initial architecturally-supported currencies (USD, SAR,
-- YER, `PCA-ADD-BILL-019`); EUR is deliberately NOT seeded (superseded
-- four-currency draft, `PCA-DEC-024`) -- backend/src/billing/currency.ts is
-- the application-layer mirror of this same three-currency set (see that
-- module's own header for why both representations exist, mirroring how
-- migration 0005 mirrors backend/src/platformadmin/audit/types.ts's event
-- vocabulary).
--
-- PRIVACY BOUNDARY (`PCA-ADD-BILL-016`, restating `PCA-FR-136`/`PCA-SEC-023`):
-- no table below can ever hold a doc 09 Section 5.2 data class. Every
-- account/family reference in this migration is an opaque VARCHAR
-- identifier, never a channel for family activity or policy content.
--
-- PAYMENT SECURITY (`PCA-ADD-BILL-023`/024): `billing_payment_methods`
-- carries ONLY provider-safe, display-safe metadata -- there is no column
-- anywhere in this migration capable of holding a full PAN, CVV/CVC, raw
-- card magnetic/chip data, a raw bank debit credential, or an unredacted
-- payment-provider secret. Asserted by
-- backend/test/schema-privacy.test.mjs (static) and
-- backend/test/db/schema-privacy.mysql.test.mjs (live).
--
-- This migration introduces 14 new tables. No existing table is altered.

-- ---------------------------------------------------------------------------
-- 1. billing_currencies
-- ---------------------------------------------------------------------------
CREATE TABLE billing_currencies (
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  minor_unit_exponent TINYINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (currency_code),
  CONSTRAINT billing_currencies_code_check CHECK (currency_code REGEXP '^[A-Z]{3}$')
) ENGINE=InnoDB;

INSERT INTO billing_currencies (currency_code, minor_unit_exponent, enabled) VALUES
  ('USD', 2, 1),
  ('SAR', 2, 1),
  ('YER', 2, 1);

-- ---------------------------------------------------------------------------
-- 2. billing_commercial_markets
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-045`: YEMEN, GULF, GLOBAL_OTHER (the catch-all default) --
-- each carrying its default charge currency (`PCA-ADD-BILL-019`'s
-- YEMEN->YER, GULF->SAR, GLOBAL/OTHER->USD mapping).
CREATE TABLE billing_commercial_markets (
  commercial_market VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  default_currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (commercial_market),
  CONSTRAINT billing_commercial_markets_market_check CHECK (commercial_market IN ('YEMEN', 'GULF', 'GLOBAL_OTHER')),
  CONSTRAINT billing_commercial_markets_currency_fk FOREIGN KEY (default_currency_code) REFERENCES billing_currencies (currency_code)
) ENGINE=InnoDB;

INSERT INTO billing_commercial_markets (commercial_market, default_currency_code) VALUES
  ('YEMEN', 'YER'),
  ('GULF', 'SAR'),
  ('GLOBAL_OTHER', 'USD');

-- ---------------------------------------------------------------------------
-- 3. billing_country_market_rules
-- ---------------------------------------------------------------------------
-- Constraint 3 (mission spec): country/region -> commercial market
-- assignment MUST be data/config-driven, not a hardcoded permanent
-- Gulf-country list baked into application logic. This table IS that
-- configuration surface -- a row's absence for a given country falls back
-- to GLOBAL_OTHER (the catch-all default), never an application-code
-- if/else chain. Seeded here with a reviewed starter rule set; a later
-- Platform Administration settings surface (Section 16) administers this
-- table directly, not a source-code list.
CREATE TABLE billing_country_market_rules (
  country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  commercial_market VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (country_code),
  CONSTRAINT billing_country_market_rules_market_fk FOREIGN KEY (commercial_market) REFERENCES billing_commercial_markets (commercial_market),
  CONSTRAINT billing_country_market_rules_country_check CHECK (country_code REGEXP '^[A-Z]{2}$')
) ENGINE=InnoDB;

INSERT INTO billing_country_market_rules (country_code, commercial_market) VALUES
  ('YE', 'YEMEN'),
  ('SA', 'GULF'),
  ('AE', 'GULF'),
  ('QA', 'GULF'),
  ('KW', 'GULF'),
  ('BH', 'GULF'),
  ('OM', 'GULF');

-- ---------------------------------------------------------------------------
-- 4. billing_price_books
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-002`/043/044: the App-Owner-maintained, versioned pricing
-- table for device-entitlement increases. NO price literal is seeded by
-- this migration (`PCA-DEC-024`'s pricing-authority note -- every real price
-- is entered at runtime through the price-book publication service,
-- backend/src/billing/priceBook.ts).
--
-- EFFECTIVE-PERIOD AMBIGUITY (constraint 7/8): `open_active_key` is a
-- generated column that is non-NULL only when a row is the CURRENTLY OPEN
-- (status='ACTIVE' AND effective_to IS NULL) price for its commercial key
-- (market, currency, target_device_limit). The UNIQUE KEY over that column
-- makes "at most one currently-open active price per commercial key" a
-- real, DB-enforced invariant, not an application-only convention or a
-- `SELECT ... LIMIT 1` masking a genuine ambiguity: publishing a new price
-- for a key that already has an open active row requires the publishing
-- transaction to first supersede (RETIRE, set effective_to) the prior row,
-- and two concurrent transactions racing to publish for the same key can
-- never both land an open-active row -- the second's INSERT deterministically
-- fails with ER_DUP_ENTRY (see
-- backend/test/db/billingCorePriceBookConcurrency.mysql.test.mjs).
-- `price_book_version` is additionally unique per commercial key as a second,
-- independent line of defense against a version-number race.
CREATE TABLE billing_price_books (
  price_book_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  commercial_market VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_device_limit INT UNSIGNED NOT NULL,
  amount_minor BIGINT NOT NULL,
  price_book_version INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL,
  effective_from DATETIME(3) NOT NULL,
  effective_to DATETIME(3) NULL,
  created_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  open_active_key VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN status = 'ACTIVE' AND effective_to IS NULL
      THEN CONCAT(commercial_market, '|', currency_code, '|', target_device_limit)
      ELSE NULL END
  ) STORED,
  PRIMARY KEY (price_book_id),
  UNIQUE KEY billing_price_books_open_active_key (open_active_key),
  UNIQUE KEY billing_price_books_key_version (commercial_market, currency_code, target_device_limit, price_book_version),
  KEY billing_price_books_lookup_idx (commercial_market, currency_code, target_device_limit, effective_from),
  CONSTRAINT billing_price_books_market_fk FOREIGN KEY (commercial_market) REFERENCES billing_commercial_markets (commercial_market),
  CONSTRAINT billing_price_books_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_price_books_admin_fk FOREIGN KEY (created_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT billing_price_books_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT billing_price_books_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT billing_price_books_target_check CHECK (target_device_limit >= 1),
  -- >= rather than a strict > : two racing publish attempts for the same
  -- key can legitimately capture `now` at the same millisecond (both
  -- Date.now() calls happen in the same synchronous tick before either
  -- awaits) -- a superseded row's effective_to may therefore equal its own
  -- effective_from exactly. That represents a real, valid zero-duration
  -- exposure window, not a data error; the UNIQUE KEY above (not this
  -- CHECK) is what actually enforces the non-ambiguity invariant.
  CONSTRAINT billing_price_books_period_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 5. billing_quotes
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-005A`: a one-off, App-Owner-issued price for a custom
-- (no-published-price-book-row) device-entitlement increase quantity.
-- `increase_request_ref` (constraint 13): a bounded opaque identifier only
-- -- NO foreign key to any entitlement/increase-request table (Agent42's
-- parallel lane, migration 0006, may not even exist in this worktree).
CREATE TABLE billing_quotes (
  quote_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  increase_request_ref VARCHAR(64) NULL,
  commercial_market VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_device_limit INT UNSIGNED NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  status VARCHAR(16) NOT NULL,
  PRIMARY KEY (quote_id),
  KEY billing_quotes_increase_request_ref_idx (increase_request_ref),
  CONSTRAINT billing_quotes_market_fk FOREIGN KEY (commercial_market) REFERENCES billing_commercial_markets (commercial_market),
  CONSTRAINT billing_quotes_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_quotes_admin_fk FOREIGN KEY (issued_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT billing_quotes_status_check CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED', 'SUPERSEDED')),
  CONSTRAINT billing_quotes_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT billing_quotes_target_check CHECK (target_device_limit >= 1),
  CONSTRAINT billing_quotes_increase_request_ref_check CHECK (increase_request_ref IS NULL OR CHAR_LENGTH(increase_request_ref) BETWEEN 1 AND 64),
  CONSTRAINT billing_quotes_expiry_check CHECK (expires_at > issued_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 6. billing_plans
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-001`: versioned commercial offering. A plan change creates a
-- new (plan_code, version) row rather than mutating history.
CREATE TABLE billing_plans (
  plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_code VARCHAR(64) NOT NULL,
  plan_version INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL,
  billing_cadence VARCHAR(16) NOT NULL,
  default_parent_member_limit INT UNSIGNED NOT NULL,
  default_managed_device_limit INT UNSIGNED NOT NULL,
  price_book_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (plan_id),
  UNIQUE KEY billing_plans_code_version (plan_code, plan_version),
  CONSTRAINT billing_plans_price_book_fk FOREIGN KEY (price_book_id) REFERENCES billing_price_books (price_book_id),
  CONSTRAINT billing_plans_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT billing_plans_cadence_check CHECK (billing_cadence IN ('MONTHLY', 'ANNUAL', 'ONE_TIME', 'FREE')),
  CONSTRAINT billing_plans_plan_code_check CHECK (CHAR_LENGTH(plan_code) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 7. billing_subscriptions
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-003`: at most one active subscription per account/family --
-- a genuine, concurrency-safe DB invariant via `active_account_key`, a
-- generated column non-NULL only while status is TRIALING/ACTIVE/PAST_DUE
-- (the three "currently occupies the family's one subscription slot"
-- states), with a UNIQUE KEY over it.
CREATE TABLE billing_subscriptions (
  subscription_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_ref VARCHAR(64) NOT NULL,
  plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  current_period_start DATETIME(3) NOT NULL,
  current_period_end DATETIME(3) NOT NULL,
  payment_method_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  canceled_at DATETIME(3) NULL,
  active_account_key VARCHAR(80) GENERATED ALWAYS AS (
    CASE WHEN status IN ('TRIALING', 'ACTIVE', 'PAST_DUE') THEN account_ref ELSE NULL END
  ) STORED,
  PRIMARY KEY (subscription_id),
  UNIQUE KEY billing_subscriptions_active_account_key (active_account_key),
  KEY billing_subscriptions_account_ref_idx (account_ref),
  CONSTRAINT billing_subscriptions_plan_fk FOREIGN KEY (plan_id) REFERENCES billing_plans (plan_id),
  CONSTRAINT billing_subscriptions_status_check CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  CONSTRAINT billing_subscriptions_account_ref_check CHECK (CHAR_LENGTH(account_ref) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 8. billing_payment_methods
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-008`/024: provider-safe metadata ONLY. See this file's own
-- header PAYMENT SECURITY note -- no PAN/CVV/raw-credential column exists or
-- may ever be added to this table.
CREATE TABLE billing_payment_methods (
  payment_method_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_ref VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_payment_method_ref VARCHAR(128) NOT NULL,
  brand VARCHAR(32) NULL,
  display_label VARCHAR(64) NOT NULL,
  last4 CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expiry_month TINYINT UNSIGNED NULL,
  expiry_year SMALLINT UNSIGNED NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (payment_method_id),
  KEY billing_payment_methods_account_ref_idx (account_ref),
  CONSTRAINT billing_payment_methods_status_check CHECK (status IN ('ACTIVE', 'REMOVED')),
  CONSTRAINT billing_payment_methods_last4_check CHECK (last4 IS NULL OR last4 REGEXP '^[0-9]{4}$'),
  CONSTRAINT billing_payment_methods_expiry_month_check CHECK (expiry_month IS NULL OR expiry_month BETWEEN 1 AND 12),
  CONSTRAINT billing_payment_methods_account_ref_check CHECK (CHAR_LENGTH(account_ref) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

ALTER TABLE billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_payment_method_fk FOREIGN KEY (payment_method_id) REFERENCES billing_payment_methods (payment_method_id);

-- ---------------------------------------------------------------------------
-- 9. billing_invoices
-- ---------------------------------------------------------------------------
CREATE TABLE billing_invoices (
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_ref VARCHAR(64) NOT NULL,
  subscription_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  total_amount_minor BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at DATETIME(3) NULL,
  period_start DATETIME(3) NULL,
  period_end DATETIME(3) NULL,
  PRIMARY KEY (invoice_id),
  KEY billing_invoices_account_ref_idx (account_ref),
  CONSTRAINT billing_invoices_subscription_fk FOREIGN KEY (subscription_id) REFERENCES billing_subscriptions (subscription_id),
  CONSTRAINT billing_invoices_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_invoices_status_check CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE')),
  CONSTRAINT billing_invoices_total_check CHECK (total_amount_minor >= 0),
  CONSTRAINT billing_invoices_account_ref_check CHECK (CHAR_LENGTH(account_ref) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 10. billing_invoice_lines
-- ---------------------------------------------------------------------------
CREATE TABLE billing_invoice_lines (
  invoice_line_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  description VARCHAR(255) NOT NULL,
  line_type VARCHAR(32) NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  price_book_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (invoice_line_id),
  KEY billing_invoice_lines_invoice_id_idx (invoice_id),
  CONSTRAINT billing_invoice_lines_invoice_fk FOREIGN KEY (invoice_id) REFERENCES billing_invoices (invoice_id),
  CONSTRAINT billing_invoice_lines_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_invoice_lines_plan_fk FOREIGN KEY (plan_id) REFERENCES billing_plans (plan_id),
  CONSTRAINT billing_invoice_lines_price_book_fk FOREIGN KEY (price_book_id) REFERENCES billing_price_books (price_book_id),
  CONSTRAINT billing_invoice_lines_line_type_check CHECK (line_type IN ('PLAN_CHARGE', 'PRORATION', 'DEVICE_LIMIT_INCREASE', 'CREDIT', 'OTHER')),
  CONSTRAINT billing_invoice_lines_description_check CHECK (CHAR_LENGTH(description) BETWEEN 1 AND 255),
  CONSTRAINT billing_invoice_lines_quantity_check CHECK (quantity >= 1)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 11. billing_payment_attempts
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-006`/043: every attempt preserves its OWN price/quote
-- snapshot (target_device_limit, amount_minor, currency_code,
-- price_book_version/quote_id) captured at creation time -- a later
-- PriceBook edit or Quote supersession can never retroactively change an
-- already-created attempt's terms (immutability regression coverage:
-- backend/test/db/billingCoreQuoteImmutability.mysql.test.mjs).
-- `increase_request_ref`: bounded opaque identifier only, same no-FK
-- discipline as billing_quotes (constraint 13).
CREATE TABLE billing_payment_attempts (
  payment_attempt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_ref VARCHAR(64) NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  increase_request_ref VARCHAR(64) NULL,
  payment_method_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  quote_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  price_book_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  price_book_version INT UNSIGNED NULL,
  target_device_limit INT UNSIGNED NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  provider VARCHAR(32) NULL,
  provider_reference VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (payment_attempt_id),
  KEY billing_payment_attempts_account_ref_idx (account_ref),
  KEY billing_payment_attempts_invoice_id_idx (invoice_id),
  KEY billing_payment_attempts_increase_request_ref_idx (increase_request_ref),
  CONSTRAINT billing_payment_attempts_invoice_fk FOREIGN KEY (invoice_id) REFERENCES billing_invoices (invoice_id),
  CONSTRAINT billing_payment_attempts_payment_method_fk FOREIGN KEY (payment_method_id) REFERENCES billing_payment_methods (payment_method_id),
  CONSTRAINT billing_payment_attempts_quote_fk FOREIGN KEY (quote_id) REFERENCES billing_quotes (quote_id),
  CONSTRAINT billing_payment_attempts_price_book_fk FOREIGN KEY (price_book_id) REFERENCES billing_price_books (price_book_id),
  CONSTRAINT billing_payment_attempts_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_payment_attempts_status_check CHECK (status IN ('CREATED', 'PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED')),
  CONSTRAINT billing_payment_attempts_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT billing_payment_attempts_account_ref_check CHECK (CHAR_LENGTH(account_ref) BETWEEN 1 AND 64),
  CONSTRAINT billing_payment_attempts_increase_request_ref_check CHECK (increase_request_ref IS NULL OR CHAR_LENGTH(increase_request_ref) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 12. billing_payment_transactions
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-007`: the settled record of a CONFIRMED PaymentAttempt.
-- Immutable in practice once written -- application code never issues an
-- UPDATE against this table (a later Refund is a separate row referencing
-- this one, never a mutation of it). No raw provider payload is stored --
-- `provider_transaction_ref` is an opaque reference only.
CREATE TABLE billing_payment_transactions (
  payment_transaction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_attempt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_ref VARCHAR(64) NOT NULL,
  invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_transaction_ref VARCHAR(128) NOT NULL,
  quote_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  price_book_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  price_book_version INT UNSIGNED NULL,
  confirmed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (payment_transaction_id),
  UNIQUE KEY billing_payment_transactions_attempt_key (payment_attempt_id),
  KEY billing_payment_transactions_account_ref_idx (account_ref),
  CONSTRAINT billing_payment_transactions_attempt_fk FOREIGN KEY (payment_attempt_id) REFERENCES billing_payment_attempts (payment_attempt_id),
  CONSTRAINT billing_payment_transactions_invoice_fk FOREIGN KEY (invoice_id) REFERENCES billing_invoices (invoice_id),
  CONSTRAINT billing_payment_transactions_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_payment_transactions_quote_fk FOREIGN KEY (quote_id) REFERENCES billing_quotes (quote_id),
  CONSTRAINT billing_payment_transactions_price_book_fk FOREIGN KEY (price_book_id) REFERENCES billing_price_books (price_book_id),
  CONSTRAINT billing_payment_transactions_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT billing_payment_transactions_account_ref_check CHECK (CHAR_LENGTH(account_ref) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 13. billing_refunds
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-009`: domain/state storage + validation only, no provider
-- execution. `entitlement_treatment` is the explicit, audited flag
-- constraint 23 requires -- this column NEVER drives an automatic
-- entitlement write in this lane (no entitlement table exists here to write
-- to); it exists purely so a later entitlement-owning lane can record the
-- business decision without Billing Core silently assuming one.
-- `step_up_session_id` is populated only when the refund's issuance step-up
-- was verified via Agent41's PlatformAdminAuthService.consumeStepUp with
-- scope='REFUND' -- see backend/src/billing/refund.ts.
CREATE TABLE billing_refunds (
  refund_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_transaction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(32) NOT NULL,
  reason_note VARCHAR(255) NULL,
  initiated_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  step_up_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entitlement_treatment VARCHAR(32) NOT NULL DEFAULT 'NOT_APPLICABLE',
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (refund_id),
  KEY billing_refunds_transaction_idx (payment_transaction_id),
  CONSTRAINT billing_refunds_transaction_fk FOREIGN KEY (payment_transaction_id) REFERENCES billing_payment_transactions (payment_transaction_id),
  CONSTRAINT billing_refunds_currency_fk FOREIGN KEY (currency_code) REFERENCES billing_currencies (currency_code),
  CONSTRAINT billing_refunds_admin_fk FOREIGN KEY (initiated_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT billing_refunds_step_up_fk FOREIGN KEY (step_up_session_id) REFERENCES platform_admin_step_up_sessions (step_up_id),
  CONSTRAINT billing_refunds_status_check CHECK (status IN ('RECORDED', 'FAILED')),
  CONSTRAINT billing_refunds_amount_check CHECK (amount_minor > 0),
  CONSTRAINT billing_refunds_entitlement_treatment_check CHECK (entitlement_treatment IN ('NOT_APPLICABLE', 'ENTITLEMENT_UNCHANGED', 'ENTITLEMENT_REDUCTION_PENDING')),
  CONSTRAINT billing_refunds_reason_note_check CHECK (reason_note IS NULL OR CHAR_LENGTH(reason_note) <= 255)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 14. billing_disputes
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-010`: provider-neutral chargeback/dispute record.
CREATE TABLE billing_disputes (
  dispute_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_transaction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  evidence_submitted_at DATETIME(3) NULL,
  evidence_due_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dispute_id),
  KEY billing_disputes_transaction_idx (payment_transaction_id),
  CONSTRAINT billing_disputes_transaction_fk FOREIGN KEY (payment_transaction_id) REFERENCES billing_payment_transactions (payment_transaction_id),
  CONSTRAINT billing_disputes_status_check CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'WON', 'LOST'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 15. billing_provider_events
-- ---------------------------------------------------------------------------
-- `PCA-ADD-BILL-011`/029/031: durable persistence foundation only -- NO
-- webhook signature verification is implemented in this lane (that is
-- PCA-BILL-2's scope). The UNIQUE KEY on (provider, provider_event_id) is
-- the idempotency primitive a later webhook-consuming lane relies on: two
-- connections racing to insert the same (provider, provider_event_id) can
-- never both succeed (see
-- backend/test/db/billingCoreProviderEventConcurrency.mysql.test.mjs).
CREATE TABLE billing_provider_events (
  provider_event_row_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_event_id VARCHAR(128) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processing_status VARCHAR(16) NOT NULL,
  correlation_ref VARCHAR(64) NULL,
  PRIMARY KEY (provider_event_row_id),
  UNIQUE KEY billing_provider_events_provider_event_key (provider, provider_event_id),
  CONSTRAINT billing_provider_events_status_check CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'))
) ENGINE=InnoDB;
