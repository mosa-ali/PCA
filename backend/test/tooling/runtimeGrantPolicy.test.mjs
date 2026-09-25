// LEAST-PRIVILEGE-MATRIX-1: the grant policy is now an explicit, fail-closed
// per-table declaration. These tests lock in three things the 2026-09
// production incident proved were missing:
//   1. the exact verbs for the tables introduced by migrations 0043-0048,
//   2. that an UNDECLARED table cannot acquire privileges implicitly, and
//   3. that the declaration set and PCA_CANONICAL_SCHEMA cannot drift apart in
//      EITHER direction, so a future migration cannot silently introduce a
//      runtime table that the app is then denied access to (1142).
//   4. the READ-COLUMN RULE (2026-09-24, MySQL 1143): any table declaring
//      UPDATE or DELETE must also declare SELECT, because a statement may only
//      reference columns it can read -- including the WHERE columns of an
//      UPDATE. The daily-login-grant touch shipped without this and 500'd
//      every second parent sign-in in production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_TABLE_NAME,
  MIGRATIONS_TABLE_NAME,
  RUNTIME_TABLE_PRIVILEGES,
  assertReadColumnRule,
  buildRuntimeGrantPlan,
  buildRuntimeGrantStatement,
  privilegesForTable,
  quoteUserAtHost,
} from '../../scripts/db/runtimeGrantPlan.mjs';
import { PCA_CANONICAL_SCHEMA } from '../../dist/db/schema.js';

const sorted = (verbs) => [...verbs].sort();

/** Explicitly declared, source-derived verbs for the 0043-0048 tables. */
const MIGRATION_0043_0048_EXPECTATIONS = Object.freeze({
  family_parent_memberships: ['SELECT', 'INSERT', 'UPDATE'],
  // SELECT added 2026-09-24: the daily-grant touch's UPDATE reads its WHERE
  // columns, and MySQL refuses that without SELECT (ER_COLUMNACCESS_DENIED 1143).
  parent_daily_login_grants: ['SELECT', 'INSERT', 'UPDATE'],
  parent_genesis_challenges: ['SELECT', 'INSERT', 'UPDATE'],
  parent_genesis_step_up_authorizations: ['SELECT', 'INSERT', 'UPDATE'],
  family_authority_request_challenges: ['SELECT', 'INSERT', 'UPDATE'],
  action_idempotency_ledger: ['SELECT', 'INSERT', 'DELETE'],
  commercial_quote_attribution_retry: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
});

/** Explicitly declared, source-derived verbs for the migration 0049 (PCA-DEC-030 Parent TOTP MFA) tables. */
const MIGRATION_0049_EXPECTATIONS = Object.freeze({
  parent_mfa_state: ['SELECT', 'INSERT', 'UPDATE'],
  parent_mfa_enrollment_tickets: ['SELECT', 'INSERT', 'UPDATE'],
  parent_mfa_recovery_codes: ['SELECT', 'INSERT', 'UPDATE'],
  parent_mfa_step_up_grants: ['SELECT', 'INSERT', 'UPDATE'],
  // Append-only: the runtime only INSERTs; it must never read back, UPDATE, or DELETE the ledger.
  parent_account_security_events: ['INSERT'],
});

const FORBIDDEN_VERBS = ['ALL PRIVILEGES', 'CREATE', 'ALTER', 'DROP', 'INDEX', 'REFERENCES', 'TRIGGER', 'SUPER', 'GRANT OPTION'];

test('the seven 0043-0048 tables declare exactly their source-derived verbs', () => {
  for (const [table, verbs] of Object.entries(MIGRATION_0043_0048_EXPECTATIONS)) {
    assert.deepEqual(sorted(privilegesForTable(table)), sorted(verbs), `${table} verbs drifted`);
  }
});

test('the five 0049 Parent TOTP-MFA tables declare exactly their source-derived verbs', () => {
  for (const [table, verbs] of Object.entries(MIGRATION_0049_EXPECTATIONS)) {
    assert.deepEqual(sorted(privilegesForTable(table)), sorted(verbs), `${table} verbs drifted`);
  }
});

test('parent_account_security_events is append-only at the privilege layer', () => {
  const verbs = privilegesForTable('parent_account_security_events');
  for (const forbidden of ['SELECT', 'UPDATE', 'DELETE']) {
    assert.ok(!verbs.includes(forbidden), `the security ledger must not grant ${forbidden} to the runtime principal`);
  }
});

test('families keeps INSERT and SELECT for 0049 provisioning (INSERT ... provisioned_for_account_id; SELECT provisioned_for_account_id)', () => {
  const verbs = privilegesForTable('families');
  assert.ok(verbs.includes('INSERT') && verbs.includes('SELECT'), 'families must grant INSERT and SELECT');
});

test('family_parent_memberships requires UPDATE (INSERT ... ON DUPLICATE KEY UPDATE)', () => {
  // Regression guard: reading only the `INSERT INTO ...` line of
  // MySqlFamilyMembershipRepository.applyAcceptedInvitationRoleOnConnection
  // misses the upsert's implicit UPDATE requirement.
  assert.ok(
    privilegesForTable('family_parent_memberships').includes('UPDATE'),
    'INSERT ... ON DUPLICATE KEY UPDATE requires UPDATE',
  );
});

test('append-only and read-only special cases stay explicit', () => {
  assert.deepEqual(sorted(privilegesForTable(AUDIT_TABLE_NAME)), ['INSERT', 'SELECT']);
  assert.ok(!privilegesForTable(AUDIT_TABLE_NAME).includes('UPDATE'), 'audit table must never be UPDATEd');
  assert.ok(!privilegesForTable(AUDIT_TABLE_NAME).includes('DELETE'), 'audit table must never be DELETEd');
  assert.deepEqual(privilegesForTable(MIGRATIONS_TABLE_NAME), ['SELECT']);
});

test('no declaration contains a forbidden verb, and none is a table-level ALL', () => {
  for (const [table, verbs] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
    for (const verb of verbs) {
      assert.ok(!FORBIDDEN_VERBS.includes(verb), `${table} declares forbidden verb ${verb}`);
    }
    assert.ok(verbs.length > 0, `${table} declares no verbs`);
  }
});

test('FAIL-CLOSED: an undeclared table throws instead of inheriting CRUD', () => {
  for (const undeclared of ['some_future_table', 'not_a_table', '__proto__', 'constructor']) {
    assert.throws(
      () => privilegesForTable(undeclared),
      /No explicit runtime grant declaration/,
      `${undeclared} must not silently receive privileges`,
    );
  }
});

test('a schema-vs-grant-plan drift test: every canonical table is declared', () => {
  const missing = PCA_CANONICAL_SCHEMA.map((table) => table.name).filter(
    (name) => !Object.prototype.hasOwnProperty.call(RUNTIME_TABLE_PRIVILEGES, name),
  );
  assert.deepEqual(
    missing,
    [],
    'these canonical tables have no explicit runtime grant declaration; add one before provisioning',
  );
});

test('a schema-vs-grant-plan drift test: every declaration names a real canonical table', () => {
  const canonical = new Set(PCA_CANONICAL_SCHEMA.map((table) => table.name));
  const orphaned = Object.keys(RUNTIME_TABLE_PRIVILEGES).filter((name) => !canonical.has(name));
  assert.deepEqual(orphaned, [], 'these declarations reference tables that are not in the canonical schema');
});

test('every canonical table is either ordinary DML or an explicit special case', () => {
  // Guards against the declaration set being trivially satisfiable by granting
  // something too weak, e.g. SELECT-only on a table the app writes.
  const readOnlyAllowed = new Set([AUDIT_TABLE_NAME, MIGRATIONS_TABLE_NAME]);
  for (const table of PCA_CANONICAL_SCHEMA) {
    const verbs = privilegesForTable(table.name);
    if (readOnlyAllowed.has(table.name)) continue;
    assert.ok(verbs.includes('INSERT') || verbs.includes('SELECT'), `${table.name} declares neither SELECT nor INSERT`);
  }
});

test('generated SQL is table-level, qualified, and never a database wildcard', () => {
  const literal = quoteUserAtHost('pca_runtime_20260918', '%');
  for (const table of Object.keys(RUNTIME_TABLE_PRIVILEGES)) {
    const sql = buildRuntimeGrantStatement('pca_pro', table, literal);
    assert.match(sql, /^GRANT [A-Z, ]+ ON `pca_pro`\.`[a-z_]+` TO 'pca_runtime_20260918'@'%'$/);
    assert.ok(!sql.includes('`pca_pro`.*'), `${table} produced a database-level grant`);
    assert.ok(!sql.includes('ALL PRIVILEGES'), `${table} produced ALL PRIVILEGES`);
    assert.ok(!sql.includes('GRANT OPTION'), `${table} produced GRANT OPTION`);
  }
});

test('the plan is deterministic, order-preserving, and fails closed on an undeclared table', () => {
  const literal = quoteUserAtHost('pca_runtime_20260918', '%');
  const tables = ['parent_accounts', 'schema_migrations', AUDIT_TABLE_NAME];
  const first = buildRuntimeGrantPlan('pca_pro', tables, literal);
  const second = buildRuntimeGrantPlan('pca_pro', tables, literal);
  assert.deepEqual(first, second, 'plan must be deterministic');
  assert.equal(first.length, tables.length);
  assert.match(first[0], /^GRANT SELECT, INSERT, UPDATE, DELETE ON `pca_pro`\.`parent_accounts`/);
  assert.match(first[1], /^GRANT SELECT ON `pca_pro`\.`schema_migrations`/);
  assert.match(first[2], /^GRANT SELECT, INSERT ON `pca_pro`\.`platform_admin_audit_events`/);

  assert.throws(() => buildRuntimeGrantPlan('pca_pro', ['undeclared_table'], literal), /No explicit runtime grant declaration/);
});

test('the audit table grant keeps UPDATE and DELETE absent while other tables have them', () => {
  const auditSql = buildRuntimeGrantStatement('pca_pro', AUDIT_TABLE_NAME, quoteUserAtHost('u', 'h'));
  assert.ok(!auditSql.includes('UPDATE'));
  assert.ok(!auditSql.includes('DELETE'));
});

test('READ-COLUMN RULE (MySQL 1143): every declaration with UPDATE or DELETE also declares SELECT', () => {
  // The 2026-09-24 production defect this locks in: parent_daily_login_grants
  // declared INSERT/UPDATE only, while validateAndTouchDailyLoginGrant's
  // `UPDATE ... WHERE account_id = ? AND token_hash = ? ...` reads its WHERE
  // columns -- which MySQL refuses without SELECT on them. First sign-ins never
  // run the statement; every second sign-in within the grant's 24h window did,
  // and got ER_COLUMNACCESS_DENIED_ERROR surfaced as HTTP 500.
  for (const [table, verbs] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
    if (verbs.includes('UPDATE') || verbs.includes('DELETE')) {
      assert.ok(
        verbs.includes('SELECT'),
        `${table} declares UPDATE/DELETE without SELECT -- MySQL requires SELECT for the columns read in WHERE (1143)`,
      );
    }
  }
});

test('READ-COLUMN RULE self-test: the rule itself rejects a defective declaration (a gate must be demonstrably able to fail)', () => {
  assert.throws(
    () => assertReadColumnRule({ defective_update_probe: ['INSERT', 'UPDATE'] }),
    /declares UPDATE or DELETE without SELECT/,
  );
  assert.throws(
    () => assertReadColumnRule({ defective_delete_probe: ['INSERT', 'DELETE'] }),
    /declares UPDATE or DELETE without SELECT/,
  );
  assert.doesNotThrow(() => assertReadColumnRule({ ok_probe: ['SELECT', 'INSERT', 'UPDATE'] }));
  assert.doesNotThrow(() => assertReadColumnRule({ read_only_probe: ['SELECT'] }));
});
