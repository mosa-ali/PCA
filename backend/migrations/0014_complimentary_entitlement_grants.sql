-- PCA-COMPLIMENTARY-ENTITLEMENTS-1 (Writer58, Round5): durable, explicit,
-- audited complimentary entitlement grants -- additional entitlement
-- capacity (or commercial-access) granted to selected families at no
-- charge. Implements
-- docs/implementation/addenda/PCA_ADDENDUM_004_COMPLIMENTARY_ENTITLEMENTS.md
-- (`PCA-ADD-COMP-001` through `PCA-ADD-COMP-025`).
--
-- WHAT THIS SCHEMA IS NOT (PCA-ADD-COMP-001/002/023): this migration
-- creates NO Billing-domain table (no Invoice/PaymentAttempt/
-- PaymentTransaction/ProviderEvent/PriceBook row of any kind), and it does
-- NOT alter `account_entitlements` or `entitlement_defaults`
-- (migration 0006) -- those remain the base/plan allowance record only. A
-- grant is summed ON TOP of that base at read/decision time
-- (PCA-ADD-COMP-005); this migration's own table is the ONLY place a
-- complimentary grant is ever persisted.
--
-- FAMILY-REFERENCE CONVENTION: `family_id VARCHAR(128)` follows the same
-- opaque-reference convention as `account_entitlements.family_id`
-- (migration 0006) and `enrollment_invitations.family_id` (migration
-- 0001) -- a length-checked opaque reference, never foreign-keyed to
-- `families.family_id`.
--
-- CONCURRENCY (PCA-ADD-COMP-006/021/022): every state transition
-- (create/revoke/renew/expire) is a single, self-contained,
-- database-authoritative conditional UPDATE guarded by `status = 'ACTIVE'`
-- (mirroring `billing_quotes`'s `tryConsume` pattern, migration
-- 0007_billing_core.sql / backend/src/billing/quote.ts) -- never an
-- in-memory lock, since more than one backend instance may process a
-- mutation concurrently. See
-- backend/src/entitlements/complimentary/MySqlComplimentaryGrantRepository.ts.
--
-- PRIVACY BOUNDARY (restating PCA-FR-136/PCA-SEC-023): every column here is
-- an opaque identifier, a bounded enumeration, a small integer allowance,
-- a bounded reason/note string, or a timestamp. No child
-- browsing/location/app-usage/wellbeing/screen-time content, no family
-- policy content, no family key material.
--
-- This migration introduces exactly 1 new table and ADDITIVELY widens two
-- existing migration-0005 CHECK constraints (the closed
-- platform_admin_audit_events.event_type vocabulary and the closed
-- platform_admin_step_up_sessions.scope vocabulary) to admit this lane's
-- new audit event types and its new COMPLIMENTARY_GRANT_MUTATION step-up
-- scope -- no existing accepted value in either list is removed or
-- renamed, and no other column/table from 0005 is touched.

-- ---------------------------------------------------------------------------
-- 1. complimentary_entitlement_grants
-- ---------------------------------------------------------------------------
-- PCA-ADD-COMP-003/004: the durable grant record. `entitlement_type` is the
-- bounded "grant scope" enum (PCA-ADD-COMP-004) -- COMMERCIAL_ACCESS,
-- MANAGED_DEVICE_CAPACITY, or PARENT_MEMBER_CAPACITY -- never combined
-- into one record; a family needing more than one scope of complimentary
-- capacity gets more than one grant row. `amount_or_allowance` is the
-- additive capacity amount for MANAGED_DEVICE_CAPACITY/
-- PARENT_MEMBER_CAPACITY grants; for COMMERCIAL_ACCESS grants it is a
-- fixed marker value of 1 (free-access is boolean-shaped, not a summed
-- quantity -- see ComplimentaryGrantService's COMMERCIAL_ACCESS_MARKER_AMOUNT).
--
-- `status` starts 'ACTIVE' and only ever transitions ACTIVE -> REVOKED or
-- ACTIVE -> EXPIRED, both via a single conditional
-- `UPDATE ... WHERE status = 'ACTIVE'` (PCA-ADD-COMP-006/022) -- see
-- MySqlComplimentaryGrantRepository.tryRevoke/tryExpire. Expiry is swept
-- lazily (mirroring QuoteRepository.expireDueQuotes's usage pattern) by
-- every read/mutation entry point, inside the same transaction as the
-- audit write, before that entry point's own logic runs -- never a
-- separately-scheduled background process in this lane.
--
-- `revoked_at`/`revoked_by_admin_id` are populated together, only on the
-- REVOKED transition (never on EXPIRED, which has no admin actor) --
-- enforced by complimentary_entitlement_grants_revoked_pair_check.
--
-- `revision` is an optimistic-concurrency/audit counter, incremented on
-- every mutating write, matching account_entitlements.revision's
-- convention (migration 0006).
CREATE TABLE complimentary_entitlement_grants (
  grant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) NOT NULL,
  entitlement_type VARCHAR(32) NOT NULL,
  category VARCHAR(32) NOT NULL,
  amount_or_allowance INT NOT NULL,
  effective_from DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  reason_code VARCHAR(64) NOT NULL,
  internal_note VARCHAR(2000) NULL,
  granted_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  revoked_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (grant_id),
  -- Effective-entitlement summation (PCA-ADD-COMP-005) is always scoped by
  -- (family_id, entitlement_type, status), so this composite covers the
  -- hot read path exactly; expiry sweeps scan by (status, expires_at).
  KEY complimentary_entitlement_grants_family_scope_idx (family_id, entitlement_type, status),
  KEY complimentary_entitlement_grants_expiry_idx (status, expires_at),
  KEY complimentary_entitlement_grants_granted_by_idx (granted_by_admin_id),
  CONSTRAINT complimentary_entitlement_grants_granted_by_fk FOREIGN KEY (granted_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT complimentary_entitlement_grants_revoked_by_fk FOREIGN KEY (revoked_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT complimentary_entitlement_grants_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT complimentary_entitlement_grants_entitlement_type_check CHECK (entitlement_type IN ('COMMERCIAL_ACCESS', 'MANAGED_DEVICE_CAPACITY', 'PARENT_MEMBER_CAPACITY')),
  CONSTRAINT complimentary_entitlement_grants_category_check CHECK (category IN ('FOUNDER', 'STAFF', 'STAFF_FAMILY', 'BETA_TESTER', 'PARTNER', 'PROMOTION', 'SUPPORT_EXCEPTION', 'LIFETIME_COMPLIMENTARY', 'TEMPORARY_COMPLIMENTARY', 'OTHER')),
  CONSTRAINT complimentary_entitlement_grants_status_check CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  CONSTRAINT complimentary_entitlement_grants_reason_code_check CHECK (CHAR_LENGTH(reason_code) BETWEEN 1 AND 64),
  CONSTRAINT complimentary_entitlement_grants_internal_note_check CHECK (internal_note IS NULL OR CHAR_LENGTH(internal_note) <= 2000),
  CONSTRAINT complimentary_entitlement_grants_amount_check CHECK (amount_or_allowance >= 0),
  CONSTRAINT complimentary_entitlement_grants_revoked_pair_check CHECK ((status <> 'REVOKED') OR (revoked_at IS NOT NULL AND revoked_by_admin_id IS NOT NULL)),
  CONSTRAINT complimentary_entitlement_grants_expiry_order_check CHECK (expires_at IS NULL OR expires_at > effective_from)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 2. Additive widening of migration 0005's closed CHECK vocabularies
-- ---------------------------------------------------------------------------
-- PCA-ADD-COMP-016: four new audit event types this lane emits, added to
-- the existing platform_admin_audit_events_event_type_check list (every
-- previously-accepted value is preserved verbatim). Mirrors
-- backend/src/platformadmin/audit/types.ts's PLATFORM_ADMIN_AUDIT_EVENT_TYPES
-- -- a reviewer changing one MUST change the other.
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
    'COMPLIMENTARY_GRANT_REVOKED', 'COMPLIMENTARY_GRANT_EXPIRED'
  ));

-- PCA-ADD-COMP-015: new step-up scope COMPLIMENTARY_GRANT_MUTATION, added
-- to the existing platform_admin_step_up_sessions_scope_check list (every
-- previously-accepted value preserved verbatim). Mirrors
-- backend/src/platformadmin/auth/types.ts's PLATFORM_ADMIN_STEP_UP_SCOPES.
ALTER TABLE platform_admin_step_up_sessions
  DROP CHECK platform_admin_step_up_sessions_scope_check,
  ADD CONSTRAINT platform_admin_step_up_sessions_scope_check CHECK (scope IN (
    'REFUND', 'SETTLEMENT_BANK_CONFIG', 'ADMIN_ROLE_GRANT',
    'FAMILY_ACCOUNT_SUSPEND', 'FAMILY_ACCOUNT_REACTIVATE',
    'ENTITLEMENT_LIMIT_OVERRIDE', 'COMPLIMENTARY_GRANT_MUTATION'
  ));
