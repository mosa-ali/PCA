-- PCA-PA-1: PCA Platform Administration -- admin identity, RBAC, MFA,
-- step-up, and audit foundation. Implements
-- docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md
-- Sections 3, 4, and 17 (`PCA-ADD-PA-001` through `PCA-ADD-PA-020`, and
-- `PCA-ADD-PA-045`/`046`).
--
-- ARCHITECTURAL SEPARATION (PCA-ADD-PA-001/002/010): every table in this
-- migration belongs to a THIRD, independent trust plane -- "PCA Platform
-- Administration" -- that is not the family/parent plane (service_accounts,
-- service_sessions, families, licenses -- see 0001_mysql_baseline.sql) and
-- shares NO foreign key, NO session/token type, and NO role vocabulary with
-- it. A platform_admin_sessions token can never be replayed as a
-- service_sessions token and vice versa (see
-- backend/src/auth/fastifyAuthPlugin.ts vs.
-- backend/src/platformadmin/auth/fastifyPlatformAdminAuthPlugin.ts, and the
-- cross-realm rejection test in backend/test/db/platformadmin.mysql.test.mjs).
--
-- PRIVACY BOUNDARY (PCA-ADD-PA-005/009, restating PCA-FR-136/PCA-SEC-023):
-- no table below can ever hold a doc 09 Section 5.2 data class (child
-- browsing/location/app-usage/YouTube/wellbeing/screen-time content, family
-- policy content, or family key material -- DSK/DEK/FDEK/recovery secret).
-- This is a structural property: every column here is either an opaque
-- identifier/hash, an operator-chosen display label, a role/status
-- enumeration, or a timestamp -- never a field capable of carrying family
-- plaintext. `platform_admin_audit_events.metadata_json` is the only
-- semi-free-form field and is explicitly restricted (see its own comment
-- below) to structured, non-secret, length-bounded operational metadata,
-- enforced in the application layer
-- (backend/src/platformadmin/audit/types.ts) before every insert.
--
-- This migration introduces exactly 7 new tables. No existing table is
-- altered.

-- ---------------------------------------------------------------------------
-- 1. platform_admin_accounts
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-013: a dedicated Platform Administration account -- a distinct
-- identity record, never a repurposed family/parent account record (no FK
-- to service_accounts/families exists anywhere in this migration, by
-- design).
--
-- email_hash stores SHA-256 of the normalized-lowercase operator email --
-- never the raw email -- mirroring service_accounts.account_reference_hash's
-- opaque-hash-for-lookup pattern (0001_mysql_baseline.sql). The email
-- itself is operator PII, not family data, but there is no operational
-- need to store it in the clear when a deterministic hash is sufficient for
-- unique lookup at login time.
--
-- password_credential is an application-encoded scrypt string
-- (`scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`), never a raw or reversibly
-- encrypted password. Hashed with node:crypto's built-in scrypt (no new
-- npm dependency) -- see backend/src/platformadmin/auth/passwordCredential.ts.
--
-- status/disabled_at: disabling an account (PLATFORM_ADMIN or FINANCE_ADMIN
-- being removed, a compromised account, etc.) must force-revoke every
-- active session for that admin in the SAME transaction
-- (PlatformAdminAccountService.disableAccount) -- see
-- platform_admin_sessions below.
CREATE TABLE platform_admin_accounts (
  admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_hash VARBINARY(32) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  password_credential VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  disabled_at DATETIME(3) NULL,
  PRIMARY KEY (admin_id),
  UNIQUE KEY platform_admin_accounts_email_hash_key (email_hash),
  CONSTRAINT platform_admin_accounts_display_name_check CHECK (CHAR_LENGTH(display_name) BETWEEN 1 AND 128),
  CONSTRAINT platform_admin_accounts_password_credential_check CHECK (CHAR_LENGTH(password_credential) BETWEEN 1 AND 255),
  CONSTRAINT platform_admin_accounts_status_check CHECK (status IN ('ACTIVE', 'DISABLED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 2. platform_admin_role_assignments
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-015: dedicated RBAC, entirely independent of doc 18's family
-- permission matrix. Role vocabulary is Section 3's five roles: APP_OWNER,
-- PLATFORM_ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, AUDITOR_READ_ONLY -- see
-- backend/src/platformadmin/auth/rbacPolicy.ts for the enforced permission
-- matrix over this vocabulary (PCA-ADD-PA-008's AUDITOR_READ_ONLY-is-
-- read-only proof lives there as a unit test, not in this schema).
--
-- granted_by_admin_id is nullable: NULL means system/bootstrap-granted (the
-- first APP_OWNER created by scripts/bootstrap-platform-owner.mjs has no
-- prior actor to record -- see that script's own header comment for why no
-- separate "bootstrap used" flag table is needed).
--
-- active_role_marker + the unique key below make "at most one ACTIVE grant
-- per (admin, role)" a real, DB-enforced invariant rather than an
-- application-only convention: MySQL unique keys treat multiple NULL values
-- in a column as mutually distinct, so any number of REVOKED rows
-- (active_role_marker = NULL) for the same (admin_id, role) never collide
-- with each other or with a later re-grant; only two SIMULTANEOUSLY ACTIVE
-- grants of the same role to the same admin collide, which is exactly the
-- "duplicate active role grant" case PlatformAdminAccountService.assignRole
-- must reject (asserted via isDuplicateEntry in
-- backend/test/db/platformadmin.mysql.test.mjs).
CREATE TABLE platform_admin_role_assignments (
  assignment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(32) NOT NULL,
  granted_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  granted_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  active_role_marker VARCHAR(32) GENERATED ALWAYS AS (CASE WHEN revoked_at IS NULL THEN role ELSE NULL END) STORED,
  PRIMARY KEY (assignment_id),
  UNIQUE KEY platform_admin_role_assignments_admin_active_key (admin_id, active_role_marker),
  KEY platform_admin_role_assignments_admin_id_idx (admin_id),
  CONSTRAINT platform_admin_role_assignments_admin_id_fk FOREIGN KEY (admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_role_assignments_granted_by_fk FOREIGN KEY (granted_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_role_assignments_role_check CHECK (role IN ('APP_OWNER', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 3. platform_admin_sessions
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-014: a dedicated session type, audience-scoped so a Platform
-- Administration session token is rejected by any family-facing endpoint
-- and vice versa. Enforcement is layered:
--   (a) an entirely separate table (no shared PK space, no shared FK) from
--       service_sessions;
--   (b) raw tokens are prefixed `pa_` before hashing/issuance (see
--       backend/src/platformadmin/auth/token.ts), and every family-plane
--       token parser (backend/src/auth/token.ts's isPlausibleSessionToken)
--       rejects that shape outright, before ever attempting a hash lookup
--       -- symmetrically, this plane's own
--       isPlausiblePlatformAdminSessionToken rejects any token missing the
--       `pa_` prefix, so a service_sessions raw token is never even looked
--       up here;
--   (c) the `realm` column below is a belt-and-suspenders literal marker
--       making the audience explicit and queryable -- the actual security
--       boundary is (a) and (b), not this column, since a forged row could
--       in principle set realm correctly; it exists so a reviewer or
--       future migration can assert the invariant in SQL, not just in
--       application code.
CREATE TABLE platform_admin_sessions (
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  realm VARCHAR(24) NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (session_id),
  UNIQUE KEY platform_admin_sessions_token_hash_key (token_hash),
  KEY platform_admin_sessions_admin_id_idx (admin_id),
  CONSTRAINT platform_admin_sessions_admin_id_fk FOREIGN KEY (admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_sessions_token_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT platform_admin_sessions_realm_check CHECK (realm = 'PLATFORM_ADMIN')
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 4. platform_admin_mfa_state
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-016: MFA is mandatory, not optional/configurable-off, for
-- every Platform Administration account, at every login, with no bypass --
-- PlatformAdminAuthService.login refuses to complete authentication for
-- any account whose MFA status is not exactly ACTIVE (PENDING_SETUP and
-- DISABLED both fail closed, with the same single generic error as every
-- other login failure -- see AuthService's UNAUTHORIZED discipline this
-- mirrors).
--
-- The raw TOTP secret is NEVER stored in plaintext: totp_secret_ciphertext
-- is AES-256-GCM(secret) and totp_secret_nonce is that cipher's IV, keyed
-- by PLATFORM_ADMIN_MFA_ENC_KEY (a required 64-hex-char/32-byte env var --
-- every MFA enroll/verify operation throws synchronously and refuses if
-- that key is absent or malformed; see
-- backend/src/platformadmin/auth/totp.ts's top comment for the fail-closed
-- contract). Base32 secret encoding/decoding and RFC 6238 TOTP are
-- implemented against node:crypto's HMAC-SHA1 primitive only -- no new npm
-- dependency.
CREATE TABLE platform_admin_mfa_state (
  admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  totp_secret_ciphertext VARBINARY(255) NULL,
  totp_secret_nonce VARBINARY(16) NULL,
  activated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (admin_id),
  CONSTRAINT platform_admin_mfa_state_admin_id_fk FOREIGN KEY (admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_mfa_state_status_check CHECK (status IN ('PENDING_SETUP', 'ACTIVE', 'DISABLED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 5. platform_admin_step_up_sessions
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-017: step-up authentication for sensitive actions (refund
-- issuance, settlement/bank configuration changes, admin role grants,
-- family account suspend/reactivate, entitlement-limit overrides) --
-- mirroring doc 18 Section 4's family step-up pattern (see
-- backend/src/familyrbac/policy.ts's STEP_UP_MAX_FRESHNESS_MS) but as a
-- fully independent implementation and constant (5 minutes, redefined
-- here, never imported from the family plane -- PCA-ADD-PA-012's "not a
-- shared code path" requirement).
--
-- Step-up here is single-use and strictly narrower than the family-plane
-- pattern: consumed_at is set the moment a step-up grant is presented to
-- authorize one sensitive operation, and a consumed row can never be
-- reused even if expires_at has not yet passed
-- (PlatformAdminAuthService.consumeStepUp's guarded UPDATE requires
-- consumed_at IS NULL).
CREATE TABLE platform_admin_step_up_sessions (
  step_up_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope VARCHAR(40) NOT NULL,
  asserted_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (step_up_id),
  KEY platform_admin_step_up_sessions_admin_id_idx (admin_id),
  KEY platform_admin_step_up_sessions_session_id_idx (session_id),
  CONSTRAINT platform_admin_step_up_sessions_admin_id_fk FOREIGN KEY (admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_step_up_sessions_session_id_fk FOREIGN KEY (session_id) REFERENCES platform_admin_sessions (session_id),
  CONSTRAINT platform_admin_step_up_sessions_scope_check CHECK (scope IN ('REFUND', 'SETTLEMENT_BANK_CONFIG', 'ADMIN_ROLE_GRANT', 'FAMILY_ACCOUNT_SUSPEND', 'FAMILY_ACCOUNT_REACTIVATE', 'ENTITLEMENT_LIMIT_OVERRIDE'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 6. platform_admin_login_attempts
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-020: rate-limiting/lockout on Platform Administration
-- authentication attempts is mandatory. email_hash is recorded for EVERY
-- attempt, including an unrecognized email -- this table structurally
-- cannot distinguish "unknown email" from "known email, wrong password"
-- (the same hash function as platform_admin_accounts.email_hash is used
-- for both), so lockout/rate-limit logic built on it never becomes an
-- account-existence oracle.
--
-- Lockout policy (backend/src/platformadmin/auth/policy.ts's isLockedOut,
-- a pure function over a list of attempt timestamps, unit-tested directly
-- without a DB): within a rolling 15-minute window, 5 or more
-- FAILED_CREDENTIALS/FAILED_MFA attempts for the same email_hash locks out
-- further attempts until the window rolls past the 5th-most-recent
-- failure.
CREATE TABLE platform_admin_login_attempts (
  attempt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_hash VARBINARY(32) NOT NULL,
  outcome VARCHAR(20) NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (attempt_id),
  KEY platform_admin_login_attempts_email_hash_occurred_at_idx (email_hash, occurred_at),
  CONSTRAINT platform_admin_login_attempts_outcome_check CHECK (outcome IN ('SUCCESS', 'FAILED_CREDENTIALS', 'FAILED_MFA', 'LOCKED_OUT'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- 7. platform_admin_audit_events
-- ---------------------------------------------------------------------------
-- PCA-ADD-PA-018/045/046: Platform Administration's own append-only,
-- integrity-protected audit log, architecturally independent of doc 18
-- Section 5's family ParentActionAudit (different plane -- Section 2 of
-- the addendum), but following the same "immutable-in-practice, opaque
-- event ID, actor, timestamp, action type, target, result" contract.
--
-- event_type's CHECK list below MUST stay in sync with
-- backend/src/platformadmin/audit/types.ts's PLATFORM_ADMIN_AUDIT_EVENT_TYPES
-- export -- that module is the single source of truth a reviewer should
-- diff this CHECK constraint against. It includes every event type named
-- in PCA-ADD-PA-045 (including the Billing/entitlement event types that
-- workstream explicitly requires this vocabulary to be future-proofed
-- for -- PRICE_BOOK_CHANGED, QUOTE_ISSUED, PAYMENT_CONFIRMED,
-- ENTITLEMENT_INCREASED, PAYMENT_ROLLED_BACK, DEVICE_LIMIT_CHANGED,
-- LIMIT_REQUEST_APPROVED/DENIED, PLAN_CHANGED, PAYMENT_REFUNDED,
-- BANK_SETTING_CHANGED -- NONE of which this PCA-PA-1 lane's code ever
-- writes; only the auth/session/audit event types are actually emitted
-- here), plus the PCA-PA-1-specific ones this lane's code does write:
-- ADMIN_SESSION_REVOKED, ADMIN_LOGIN_LOCKED_OUT, ADMIN_STEP_UP_GRANTED,
-- ADMIN_STEP_UP_DENIED, ADMIN_MFA_ENROLLED.
--
-- actor_admin_id is nullable: pre-authentication events (a failed login
-- for an unrecognized email) and the bootstrap-created first APP_OWNER
-- (no prior actor) both legitimately have no actor. target_ref is an
-- opaque string (e.g. `admin:<uuid>`, `session:<uuid>`) -- this table
-- structurally cannot reference a family/child identifier, so it can never
-- become a vector for correlating platform-admin action to family
-- activity content.
--
-- metadata_json holds ONLY structured, non-secret, length-bounded
-- operational metadata -- application code
-- (backend/src/platformadmin/audit/types.ts's validateAndTruncateMetadata)
-- enforces a 2048-byte cap before every insert, mirroring doc 18 Section
-- 5's MAX_AUDIT_NOTE_LENGTH free-text-minimization discipline. It must
-- NEVER hold a raw password, raw TOTP code, raw session token, or any
-- Section 11-prohibited payment instrument data -- enforced by the same
-- application-layer validation, and independently asserted by a test that
-- greps every audit row's serialized JSON for the exact secret values used
-- in that test (backend/test/db/platformadmin.mysql.test.mjs).
--
-- APPEND-ONLY ENFORCEMENT: the two triggers below give genuine DB-level
-- immutability, not just an application-layer convention -- ANY UPDATE or
-- DELETE against this table is rejected with a MySQL error
-- (SQLSTATE '45000'), regardless of which application code or database
-- user attempts it. This is a stronger guarantee than "the service layer
-- never issues an UPDATE/DELETE statement," which a bug or a future
-- careless migration could silently violate.
CREATE TABLE platform_admin_audit_events (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  actor_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_role VARCHAR(32) NULL,
  target_ref VARCHAR(128) NULL,
  result VARCHAR(16) NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metadata_json JSON NULL,
  PRIMARY KEY (event_id),
  KEY platform_admin_audit_events_actor_admin_id_idx (actor_admin_id),
  KEY platform_admin_audit_events_event_type_idx (event_type),
  KEY platform_admin_audit_events_occurred_at_idx (occurred_at),
  CONSTRAINT platform_admin_audit_events_actor_admin_id_fk FOREIGN KEY (actor_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_audit_events_event_type_check CHECK (event_type IN (
    'ADMIN_LOGIN', 'ADMIN_LOGIN_FAILED', 'ADMIN_CREATED', 'ADMIN_ROLE_CHANGED',
    'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED', 'DEVICE_LIMIT_CHANGED',
    'LIMIT_REQUEST_APPROVED', 'LIMIT_REQUEST_DENIED', 'PLAN_CHANGED',
    'PAYMENT_REFUNDED', 'BANK_SETTING_CHANGED', 'SETTING_CHANGED',
    'PRICE_BOOK_CHANGED', 'QUOTE_ISSUED', 'PAYMENT_CONFIRMED',
    'ENTITLEMENT_INCREASED', 'PAYMENT_ROLLED_BACK',
    'ADMIN_SESSION_REVOKED', 'ADMIN_LOGIN_LOCKED_OUT',
    'ADMIN_STEP_UP_GRANTED', 'ADMIN_STEP_UP_DENIED', 'ADMIN_MFA_ENROLLED'
  )),
  CONSTRAINT platform_admin_audit_events_actor_role_check CHECK (actor_role IS NULL OR actor_role IN ('APP_OWNER', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY')),
  CONSTRAINT platform_admin_audit_events_target_ref_check CHECK (target_ref IS NULL OR CHAR_LENGTH(target_ref) BETWEEN 1 AND 128),
  CONSTRAINT platform_admin_audit_events_result_check CHECK (result IN ('SUCCESS', 'FAILURE', 'DENIED'))
) ENGINE=InnoDB;

-- NOTE: deliberately single-statement trigger bodies (no BEGIN...END block,
-- no DELIMITER change) -- backend/scripts/migrate.mjs and
-- backend/scripts/verify-mysql.mjs run migrations through mysql2's
-- multipleStatements mode, which sends this file to the server as a plain
-- semicolon-separated statement stream and has no concept of the MySQL CLI
-- client's `DELIMITER` directive. A compound BEGIN...END trigger body would
-- need its own internal semicolon, which would be misparsed as the end of
-- the CREATE TRIGGER statement under multipleStatements mode. A single
-- SIGNAL statement is valid MySQL trigger-body syntax without BEGIN...END
-- and has exactly one semicolon, in the correct (final) position.
CREATE TRIGGER platform_admin_audit_events_no_update
BEFORE UPDATE ON platform_admin_audit_events
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'platform_admin_audit_events is append-only: UPDATE is not permitted.';

CREATE TRIGGER platform_admin_audit_events_no_delete
BEFORE DELETE ON platform_admin_audit_events
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'platform_admin_audit_events is append-only: DELETE is not permitted.';
