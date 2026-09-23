// Pure, dependency-free, synchronous grant-planning logic for the runtime
// (least-privilege, application) MySQL principal. No DB connection here --
// this module only decides WHICH GRANT statement shape applies to a given
// table and builds the exact SQL string, so that:
//   (a) backend/scripts/provision-runtime-db-grants.mjs can import and
//       execute this against a real database, and
//   (b) backend/test/db/platformAdminAuditPrivileges.mysql.test.mjs can
//       import the SAME function and exercise the SAME grant-building code
//       path a real provisioning run would use, rather than a hand-rolled
//       parallel reimplementation that could silently drift from what
//       production actually runs.
//
// LEAST-PRIVILEGE-MATRIX-1 (2026-09-23) -- explicit per-table declarations
// ---------------------------------------------------------------------------
// This module previously classified tables into CATEGORIES: "audit table",
// "migrations table", and "everything else -> SELECT, INSERT, UPDATE,
// DELETE". That last rule was an implicit, unbounded default: because
// backend/scripts/provision-runtime-db-grants.mjs enumerates tables from
// information_schema at run time, ANY newly migrated table silently and
// automatically received full CRUD -- with no review, and with no diff
// anywhere in source. The 2026-09 production incident proved that is unsafe:
// seven tables introduced by migrations 0043-0048 were created in production
// without ever being granted to the runtime principal, and the runtime app
// failed with ER_TABLEACCESS_DENIED_ERROR (1142) on the first request that
// touched them.
//
// The rule is now the inverse and FAIL-CLOSED:
//   - RUNTIME_TABLE_PRIVILEGES declares the EXACT verbs for EVERY runtime
//     table, one explicit line per table. No category inference, no wildcard
//     fallback.
//   - A table with no declaration gets NO grant -- privilegesForTable THROWS
//     rather than defaulting. A new migration therefore cannot acquire
//     privileges implicitly; it must add a reviewed declaration, or the
//     provisioning run and the grant-policy test both fail loudly.
//   - backend/test/tooling/runtimeGrantPolicy.test.mjs additionally asserts the
//     declaration set and PCA_CANONICAL_SCHEMA agree in BOTH directions, so
//     schema-vs-grant drift is caught at CI time, not in production.
//
// Deliberate special cases, each explicit below:
//   - platform_admin_audit_events: SELECT, INSERT only -- never UPDATE/DELETE.
//     This is the actual database-level append-only enforcement mechanism
//     (replaces the removed triggers; see migration 0005's own APPEND-ONLY
//     ENFORCEMENT comment for the full MySQL-privilege-scoping rationale).
//   - schema_migrations: SELECT only -- the runtime application never writes
//     migration bookkeeping.
//
// Never granted, to any table: CREATE/ALTER/DROP/INDEX/REFERENCES/TRIGGER/
// SUPER/GRANT OPTION, and never a database-level (`db`.*) grant -- always
// table-level, always for exactly one named table.

export const AUDIT_TABLE_NAME = 'platform_admin_audit_events';
export const MIGRATIONS_TABLE_NAME = 'schema_migrations';

/**
 * Ordinary runtime DML. Named once purely to avoid transcribing the same four
 * verbs dozens of times; it is referenced ONLY by explicit, individually
 * reviewed per-table declarations in RUNTIME_TABLE_PRIVILEGES below. It is
 * never applied by table-name pattern, prefix, or category match.
 */
const DML = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

/**
 * THE authoritative table -> verbs matrix. Every runtime table appears exactly
 * once, by name. Adding a table to the schema without adding it here is a
 * FAILURE, never an implicit grant.
 */
export const RUNTIME_TABLE_PRIVILEGES = Object.freeze({
  // --- append-only / read-only special cases (never ordinary DML) ---
  [AUDIT_TABLE_NAME]: Object.freeze(['SELECT', 'INSERT']),
  [MIGRATIONS_TABLE_NAME]: Object.freeze(['SELECT']),

  // --- migrations 0043-0048. Verbs derived from the actual repository
  // statements executing against each table (INSERT INTO / SELECT ... FROM /
  // UPDATE / DELETE FROM, including implicit UPDATE via INSERT ... ON
  // DUPLICATE KEY UPDATE) -- NOT from a category rule. ---
  family_parent_memberships: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  parent_daily_login_grants: Object.freeze(['INSERT', 'UPDATE']),
  parent_genesis_challenges: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  parent_genesis_step_up_authorizations: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  family_authority_request_challenges: Object.freeze(['SELECT', 'INSERT', 'UPDATE']),
  action_idempotency_ledger: Object.freeze(['SELECT', 'INSERT', 'DELETE']),
  commercial_quote_attribution_retry: Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),

  // --- ordinary runtime DML tables (explicit declaration each) ---
  account_entitlements: DML,
  billing_commercial_markets: DML,
  billing_country_market_rules: DML,
  billing_currencies: DML,
  billing_disputes: DML,
  billing_invoice_lines: DML,
  billing_invoices: DML,
  billing_payment_attempts: DML,
  billing_payment_methods: DML,
  billing_payment_transactions: DML,
  billing_plans: DML,
  billing_price_books: DML,
  billing_provider_events: DML,
  billing_quotes: DML,
  billing_refund_operations: DML,
  billing_refunds: DML,
  billing_subscriptions: DML,
  commercial_notifications: DML,
  complimentary_entitlement_grants: DML,
  delete_now_ledger: DML,
  device_challenges: DML,
  device_protection_status: DML,
  device_public_keys: DML,
  devices: DML,
  email_outbox: DML,
  enrollment_administration_verifiers: DML,
  enrollment_bootstrap_attempts: DML,
  enrollment_invitation_transitions: DML,
  enrollment_invitations: DML,
  enrollment_protection_approval_requests: DML,
  entitlement_activation_idempotency: DML,
  entitlement_change_request_transitions: DML,
  entitlement_change_requests: DML,
  entitlement_defaults: DML,
  envelope_data_version_ledger: DML,
  envelope_message_idempotency_ledger: DML,
  envelope_replay_ledger: DML,
  eye_protection_settings: DML,
  families: DML,
  family_audit_events: DML,
  family_authority_attestations: DML,
  family_authority_chain_heads: DML,
  family_authority_genesis_anchors: DML,
  family_child_memberships: DML,
  family_member_invitations: DML,
  family_rbac_policy_config: DML,
  licenses: DML,
  managed_device_slot_reservations: DML,
  parent_account_preferences: DML,
  parent_accounts: DML,
  parent_email_verification_codes: DML,
  parent_login_step_up_codes: DML,
  parent_password_reset_codes: DML,
  platform_admin_accounts: DML,
  platform_admin_activation_tokens: DML,
  platform_admin_login_attempts: DML,
  platform_admin_mfa_state: DML,
  platform_admin_role_assignments: DML,
  platform_admin_security_alerts: DML,
  platform_admin_sessions: DML,
  platform_admin_settings: DML,
  platform_admin_step_up_sessions: DML,
  profile_protection_mode: DML,
  protection_alerts: DML,
  recovery_envelopes: DML,
  relay_envelopes: DML,
  release_current_pointers: DML,
  release_packages: DML,
  safe_zones: DML,
  security_audit_metadata: DML,
  service_account_family_scopes: DML,
  service_accounts: DML,
  service_sessions: DML,
  settlement_accounts: DML,
  settlement_batch_items: DML,
  settlement_batches: DML,
  settlement_fx_snapshots: DML,
  sync_sequence_progress_ledger: DML,
});

/** Backtick-quotes a MySQL identifier (database or table name), doubling any embedded backtick per MySQL's own escaping rule. */
export function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error(`quoteIdentifier: expected a non-empty string, got ${JSON.stringify(identifier)}`);
  }
  return '`' + identifier.replace(/`/g, '``') + '`';
}

/** Single-quotes a MySQL user/host literal for use in `'user'@'host'`, escaping backslashes and single quotes. */
export function quoteUserAtHost(user, host) {
  if (typeof user !== 'string' || user.length === 0) throw new Error('quoteUserAtHost: user is required.');
  if (typeof host !== 'string' || host.length === 0) throw new Error('quoteUserAtHost: host is required.');
  const escape = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escape(user)}'@'${escape(host)}'`;
}

/**
 * The exact declared verbs for one table.
 *
 * FAIL-CLOSED: an undeclared table THROWS. It deliberately does not fall back
 * to ordinary DML -- that fallback is precisely the defect this replaced.
 *
 * Exported separately from buildRuntimeGrantStatement so callers (and tests)
 * can assert the declaration independently of SQL string formatting.
 */
export function privilegesForTable(tableName) {
  if (!Object.prototype.hasOwnProperty.call(RUNTIME_TABLE_PRIVILEGES, tableName)) {
    throw new Error(
      `No explicit runtime grant declaration for table ${JSON.stringify(tableName)}. ` +
        'Every runtime table must declare its exact verbs in RUNTIME_TABLE_PRIVILEGES ' +
        '(scripts/db/runtimeGrantPlan.mjs). This is deliberate: a new table must never inherit ' +
        'privileges implicitly. Add a reviewed declaration before provisioning.',
    );
  }
  return [...RUNTIME_TABLE_PRIVILEGES[tableName]];
}

/**
 * Builds the exact `GRANT ... ON `db`.`table` TO 'user'@'host'` statement
 * for one table, given the already-quoted `'user'@'host'` literal (build it
 * once via quoteUserAtHost and reuse across every table in a plan).
 */
export function buildRuntimeGrantStatement(databaseName, tableName, userAtHostLiteral) {
  const privileges = privilegesForTable(tableName).join(', ');
  const qualifiedTable = `${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}`;
  return `GRANT ${privileges} ON ${qualifiedTable} TO ${userAtHostLiteral}`;
}

/**
 * Builds the full ordered list of GRANT statements for every table in
 * `tableNames` (as enumerated from information_schema.tables by the
 * caller -- this function never hardcodes a table list).
 */
export function buildRuntimeGrantPlan(databaseName, tableNames, userAtHostLiteral) {
  return tableNames.map((tableName) => buildRuntimeGrantStatement(databaseName, tableName, userAtHostLiteral));
}
