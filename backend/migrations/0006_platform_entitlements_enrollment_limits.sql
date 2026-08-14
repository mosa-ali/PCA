-- PCA-PA-2: PCA Platform Administration -- entitlement quantity model,
-- increase-request lifecycle, and concurrency-safe managed-device slot
-- reservation. Implements
-- docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md
-- Sections 5, 6, 7, 8, and 8.1 (`PCA-ADD-PA-021` through `PCA-ADD-PA-040`,
-- `PCA-ADD-PA-047`, `PCA-ADD-PA-049`, `PCA-ADD-PA-050`, `PCA-ADD-PA-054`,
-- and the composition invariants `PCA-ADD-BILL-046`/`047`).
--
-- OWNERSHIP: this migration is owned exclusively by the PCA-PA-2 lane. It
-- does not alter migration 0005's Platform Administration identity/RBAC/
-- audit tables, and it does not create any Billing Core entity (Plan,
-- PriceBook, Quote, Subscription, Invoice, PaymentAttempt,
-- PaymentTransaction, PaymentMethod, Refund, Dispute, ProviderEvent,
-- SettlementAccount, SettlementBatch, Reconciliation) -- those remain
-- Agent44/PCA-BILL-1's exclusive scope. Where this lane needs a durable
-- commercial fact (a quote price, a payment-confirmation reference), it
-- stores an immutable SNAPSHOT column on its own tables, never a live
-- reference into a Billing Core table that does not exist here.
--
-- PRIVACY BOUNDARY (restating PCA-FR-136/PCA-SEC-023, PCA-ADD-BILL-016):
-- no table below can ever hold child browsing/location/app-usage/YouTube/
-- wellbeing/screen-time content, family policy content, or family key
-- material. Every column here is an opaque identifier, a bounded
-- enumeration, a small integer counter, a commercial-amount snapshot
-- (amountMinor + currencyCode, never a live price reference), or a
-- timestamp.
--
-- FAMILY-REFERENCE CONVENTION: `family_id VARCHAR(128)` is used exactly as
-- `enrollment_invitations.family_id` / `devices.family_id` (migration
-- 0001/0003) already establish -- a length-checked opaque reference, never
-- foreign-keyed to `families.family_id`. This migration follows that
-- existing soft-reference convention rather than introducing a new one.
--
-- This migration introduces exactly 6 new tables. No existing table is
-- altered.

-- ---------------------------------------------------------------------------
-- 1. entitlement_defaults
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-024: the FREE_STARTER default (parentMemberLimit=1,
-- managedDeviceLimit=1) and any future change to those numbers is
-- Platform-Administration-owned CONFIGURATION, never a hardcoded literal
-- scattered through source. Row-per-tier so a future tier can be added
-- additively (this lane only seeds/owns FREE_STARTER, per PCA-ADD-PA-021).
--
-- Changing a row here NEVER rewrites an existing family's
-- account_entitlements row: every account_entitlements row stores its own
-- limits, copied from this table at the moment the family's entitlement is
-- first created, not read live from here on every access. See
-- backend/src/entitlements/defaults.ts / EntitlementService.getOrCreateForFamily.
CREATE TABLE entitlement_defaults (
  tier VARCHAR(32) NOT NULL,
  parent_member_limit INT NOT NULL,
  managed_device_limit INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (tier),
  CONSTRAINT entitlement_defaults_updated_by_admin_id_fk FOREIGN KEY (updated_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT entitlement_defaults_tier_check CHECK (tier = 'FREE_STARTER'),
  CONSTRAINT entitlement_defaults_parent_member_limit_check CHECK (parent_member_limit >= 0),
  CONSTRAINT entitlement_defaults_managed_device_limit_check CHECK (managed_device_limit >= 0)
) ENGINE=InnoDB;

INSERT INTO entitlement_defaults (tier, parent_member_limit, managed_device_limit, updated_at, updated_by_admin_id)
VALUES ('FREE_STARTER', 1, 1, CURRENT_TIMESTAMP(3), NULL);

-- ---------------------------------------------------------------------------
-- 2. account_entitlements
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-025/026/029: the durable, per-family entitlement record --
-- parentMemberLimit and managedDeviceLimit are modeled as two independent
-- counters (never collapsed into one ambiguous count), alongside their
-- current usage. `revision` is an optimistic-concurrency/audit counter,
-- incremented on every mutating write (see EntitlementRepository).
--
-- managed_device_active_count / managed_device_reserved_count are kept
-- distinct per PCA-ADD-PA-028/040: "2 active devices and 1 pending
-- invitation holding your last slot" must never collapse into "3 active".
-- managed_device_active_count is written only by the (currently unwired --
-- see managed_device_slot_reservations comment below) RESERVED->CONSUMED
-- transition hook, honestly reflecting that this codebase does not yet
-- implement the doc 08 PAIRED->ACTIVE transition.
--
-- over_limit_parent_member / over_limit_managed_device: PCA-ADD-PA-023 --
-- a downgrade never force-removes existing members/devices; it flips this
-- flag instead, blocking new consumption until usage falls back within
-- limit or the limit is raised again.
CREATE TABLE account_entitlements (
  family_id VARCHAR(128) NOT NULL,
  plan_ref VARCHAR(32) NOT NULL DEFAULT 'FREE_STARTER',
  parent_member_limit INT NOT NULL,
  managed_device_limit INT NOT NULL,
  parent_member_used_count INT NOT NULL DEFAULT 0,
  managed_device_active_count INT NOT NULL DEFAULT 0,
  managed_device_reserved_count INT NOT NULL DEFAULT 0,
  over_limit_parent_member TINYINT(1) NOT NULL DEFAULT 0,
  over_limit_managed_device TINYINT(1) NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (family_id),
  CONSTRAINT account_entitlements_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT account_entitlements_plan_ref_check CHECK (CHAR_LENGTH(plan_ref) BETWEEN 1 AND 32),
  CONSTRAINT account_entitlements_parent_member_limit_check CHECK (parent_member_limit >= 0),
  CONSTRAINT account_entitlements_managed_device_limit_check CHECK (managed_device_limit >= 0),
  CONSTRAINT account_entitlements_parent_member_used_count_check CHECK (parent_member_used_count >= 0),
  CONSTRAINT account_entitlements_managed_device_active_count_check CHECK (managed_device_active_count >= 0),
  CONSTRAINT account_entitlements_managed_device_reserved_count_check CHECK (managed_device_reserved_count >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 3. entitlement_change_requests
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-030/031: the full six-state increase-request lifecycle
-- (PENDING -> QUOTED -> PAYMENT_PENDING -> APPROVED|DENIED|CANCELLED),
-- shared by both limit_type values. `awaiting_admin_quote` models the
-- PENDING_ADMIN_QUOTE condition (PCA-ADD-PA-050's custom path) as a
-- strongly-typed flag on PENDING rather than a seventh state, per the
-- addendum's explicit "either is acceptable" allowance.
--
-- Quote fields (quote_kind/quote_ref/quote_amount_minor/quote_currency_code/
-- quote_price_book_version/quoted_at/quote_expires_at) are an IMMUTABLE
-- SNAPSHOT captured once at the QUOTED transition (PCA-ADD-BILL-043) --
-- never a live foreign key into a PriceBook/Quote table (which this lane
-- does not own/create). A later App-Owner price change can never mutate an
-- in-flight request's already-quoted price because there is no live
-- reference to mutate.
--
-- entitlement_change_requests_billable_check enforces PCA-ADD-PA-054: a
-- PARENT_MEMBER_LIMIT request can never carry a quote -- the two limit
-- types are never priced by a shared code path that assumes both are
-- billable.
CREATE TABLE entitlement_change_requests (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) NOT NULL,
  limit_type VARCHAR(24) NOT NULL,
  current_limit_at_request INT NOT NULL,
  target_limit INT NOT NULL,
  state VARCHAR(20) NOT NULL,
  awaiting_admin_quote TINYINT(1) NOT NULL DEFAULT 0,
  no_charge_override TINYINT(1) NOT NULL DEFAULT 0,
  quote_kind VARCHAR(16) NULL,
  quote_ref VARCHAR(64) NULL,
  quote_amount_minor BIGINT NULL,
  quote_currency_code CHAR(3) NULL,
  quote_price_book_version VARCHAR(64) NULL,
  quoted_at DATETIME(3) NULL,
  quote_expires_at DATETIME(3) NULL,
  decided_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decision_reason VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (request_id),
  KEY entitlement_change_requests_family_id_idx (family_id),
  KEY entitlement_change_requests_state_idx (state),
  CONSTRAINT entitlement_change_requests_decided_by_admin_id_fk FOREIGN KEY (decided_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT entitlement_change_requests_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT entitlement_change_requests_limit_type_check CHECK (limit_type IN ('PARENT_MEMBER_LIMIT', 'MANAGED_DEVICE_LIMIT')),
  CONSTRAINT entitlement_change_requests_state_check CHECK (state IN ('PENDING', 'QUOTED', 'PAYMENT_PENDING', 'APPROVED', 'DENIED', 'CANCELLED')),
  CONSTRAINT entitlement_change_requests_quote_kind_check CHECK (quote_kind IS NULL OR quote_kind IN ('STANDARD', 'CUSTOM')),
  CONSTRAINT entitlement_change_requests_current_limit_check CHECK (current_limit_at_request >= 0),
  CONSTRAINT entitlement_change_requests_target_limit_check CHECK (target_limit >= 0),
  CONSTRAINT entitlement_change_requests_decision_reason_check CHECK (decision_reason IS NULL OR CHAR_LENGTH(decision_reason) BETWEEN 1 AND 255),
  CONSTRAINT entitlement_change_requests_currency_code_check CHECK (quote_currency_code IS NULL OR quote_currency_code REGEXP '^[A-Z]{3}$'),
  CONSTRAINT entitlement_change_requests_quote_amount_check CHECK (quote_amount_minor IS NULL OR quote_amount_minor >= 0),
  CONSTRAINT entitlement_change_requests_billable_check CHECK (NOT (limit_type = 'PARENT_MEMBER_LIMIT' AND quote_kind IS NOT NULL))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 4. entitlement_change_request_transitions
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-031: "a timestamp per transition" -- an append-style history
-- table alongside entitlement_change_requests' current-state columns, so
-- the full PENDING->QUOTED->PAYMENT_PENDING->APPROVED path (or any
-- shortcut/denial/cancellation) remains reconstructable.
CREATE TABLE entitlement_change_request_transitions (
  transition_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_state VARCHAR(20) NULL,
  to_state VARCHAR(20) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  actor_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (transition_id),
  KEY entitlement_change_request_transitions_request_id_idx (request_id),
  CONSTRAINT entitlement_change_request_transitions_request_id_fk FOREIGN KEY (request_id) REFERENCES entitlement_change_requests (request_id),
  CONSTRAINT entitlement_change_request_transitions_actor_admin_id_fk FOREIGN KEY (actor_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT entitlement_change_request_transitions_to_state_check CHECK (to_state IN ('PENDING', 'QUOTED', 'PAYMENT_PENDING', 'APPROVED', 'DENIED', 'CANCELLED')),
  CONSTRAINT entitlement_change_request_transitions_from_state_check CHECK (from_state IS NULL OR from_state IN ('PENDING', 'QUOTED', 'PAYMENT_PENDING', 'APPROVED', 'DENIED', 'CANCELLED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 5. managed_device_slot_reservations
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-036/037/038: the four-stage device-slot pipeline's stage 2
-- (reservation) and its release/consumption bookkeeping. One reservation
-- belongs to exactly one enrollment invitation (UNIQUE on invitation_id).
--
-- CONSUMED (RESERVED -> CONSUMED) is defined here as a status value and a
-- service-layer transition (SlotReservationService.consumeForInvitation)
-- but is INTENTIONALLY NOT WIRED to any caller in this codebase: doc 08's
-- PAIRED->ACTIVE transition (first policy delivered/applied via the Family
-- Trust Set) is not implemented anywhere in backend/src today (confirmed
-- by repository survey), so this lane does not pretend a crypto-gated
-- activation event exists in order to fabricate a CONSUMED transition
-- (PCA-ADD-PA-027, restated). See the PCA-PA-2 final report's
-- PARTIAL_REQUIREMENT_IDS for PCA-ADD-PA-036/stage-4.
--
-- invitation_id is DELIBERATELY NOT foreign-keyed to enrollment_invitations:
-- PCA-ADD-PA-022/038 requires the reservation to be created and committed
-- BEFORE the invitation it is bound to is ever persisted (reserve first,
-- only create a usable invitation if the reservation succeeds -- never the
-- reverse), so a hard FK evaluated at INSERT time would reject the very
-- reservation the invitation is about to depend on. This mirrors the same
-- soft-reference convention this migration already uses for family_id and
-- the convention enrollment_invitations.family_id/devices.family_id
-- themselves established (length-checked opaque reference, not a hard FK).
CREATE TABLE managed_device_slot_reservations (
  reservation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) NOT NULL,
  invitation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  released_at DATETIME(3) NULL,
  release_reason VARCHAR(24) NULL,
  PRIMARY KEY (reservation_id),
  UNIQUE KEY managed_device_slot_reservations_invitation_id_key (invitation_id),
  KEY managed_device_slot_reservations_family_id_status_idx (family_id, status),
  CONSTRAINT managed_device_slot_reservations_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT managed_device_slot_reservations_status_check CHECK (status IN ('RESERVED', 'CONSUMED', 'RELEASED')),
  CONSTRAINT managed_device_slot_reservations_release_reason_check CHECK (release_reason IS NULL OR release_reason IN ('REVOKED', 'EXPIRED', 'ENROLLMENT_FAILED', 'ADMIN_ACTION'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 6. entitlement_activation_idempotency
-- ---------------------------------------------------------------------------
-- PCA-ADD-BILL-046: durable "claim" of a payment/provider-event id so that
-- duplicate/redelivered payment-confirmed activation is applied AT MOST
-- ONCE per approved request. `idempotency_key` is derived from the
-- payment/provider event id (never from request_id alone -- see the
-- addendum's own note that a request could theoretically receive more than
-- one terminal payment event under provider retry). The PRIMARY KEY is the
-- concurrency-safety mechanism: a second concurrent/replayed activation
-- attempt for the same key fails the INSERT with a duplicate-key error
-- (ER_DUP_ENTRY) rather than racing the entitlement UPDATE a second time.
CREATE TABLE entitlement_activation_idempotency (
  idempotency_key VARCHAR(191) NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) NOT NULL,
  applied_managed_device_limit INT NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  PRIMARY KEY (idempotency_key),
  KEY entitlement_activation_idempotency_request_id_idx (request_id),
  CONSTRAINT entitlement_activation_idempotency_request_id_fk FOREIGN KEY (request_id) REFERENCES entitlement_change_requests (request_id),
  CONSTRAINT entitlement_activation_idempotency_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT entitlement_activation_idempotency_limit_check CHECK (applied_managed_device_limit >= 0)
) ENGINE=InnoDB;
