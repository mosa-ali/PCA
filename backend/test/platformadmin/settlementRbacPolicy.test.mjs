// PCA-BILL-3 (Writer62, Round6): full role x operation matrix test for the
// four settlement RBAC operations added to rbacPolicy.ts, transcribed
// exactly from ROUND6_INTERFACE_CONTRACTS.md's SETTLEMENT_RECONCILIATION_V1
// frozen matrix. Mirrors test/billing/rbac.test.mjs's completeness-guard
// style. PLATFORM_ADMIN and SUPPORT_ADMIN are DENY on every one of these
// four operations by design (stricter than most other billing operations)
// -- explicitly asserted below, since that is the very first thing QA62
// checks per the assignment brief.
import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizePlatformAdminOperation } from '../../dist/platformadmin/auth/rbacPolicy.js';

const SETTLEMENT_OPERATIONS = ['VIEW_SETTLEMENT_RECORDS', 'MUTATE_SETTLEMENT_ACCOUNT', 'CREATE_SETTLEMENT_BATCH', 'RESOLVE_RECONCILIATION'];

const EXPECTED = {
  VIEW_SETTLEMENT_RECORDS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  MUTATE_SETTLEMENT_ACCOUNT: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  CREATE_SETTLEMENT_BATCH: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  RESOLVE_RECONCILIATION: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
};

test('full role x settlement-operation matrix matches ROUND6_INTERFACE_CONTRACTS.md exactly', () => {
  for (const operation of SETTLEMENT_OPERATIONS) {
    for (const role of Object.keys(EXPECTED[operation])) {
      const expected = EXPECTED[operation][role];
      const actual = authorizePlatformAdminOperation([role], operation);
      assert.equal(actual, expected, `${role} x ${operation}: expected ${expected}, got ${actual}`);
    }
  }
});

test('PLATFORM_ADMIN is DENY on every settlement operation, including VIEW', () => {
  for (const operation of SETTLEMENT_OPERATIONS) {
    assert.equal(authorizePlatformAdminOperation(['PLATFORM_ADMIN'], operation), 'DENY', operation);
  }
});

test('SUPPORT_ADMIN is DENY on every settlement operation, including VIEW', () => {
  for (const operation of SETTLEMENT_OPERATIONS) {
    assert.equal(authorizePlatformAdminOperation(['SUPPORT_ADMIN'], operation), 'DENY', operation);
  }
});

test('AUDITOR_READ_ONLY may VIEW settlement records but may not mutate any of them', () => {
  assert.equal(authorizePlatformAdminOperation(['AUDITOR_READ_ONLY'], 'VIEW_SETTLEMENT_RECORDS'), 'ALLOW');
  assert.equal(authorizePlatformAdminOperation(['AUDITOR_READ_ONLY'], 'MUTATE_SETTLEMENT_ACCOUNT'), 'DENY');
  assert.equal(authorizePlatformAdminOperation(['AUDITOR_READ_ONLY'], 'CREATE_SETTLEMENT_BATCH'), 'DENY');
  assert.equal(authorizePlatformAdminOperation(['AUDITOR_READ_ONLY'], 'RESOLVE_RECONCILIATION'), 'DENY');
});

test('a multi-role admin who ALSO holds PLATFORM_ADMIN alongside FINANCE_ADMIN still gets ALLOW (any-role-permits semantics, not most-restrictive)', () => {
  assert.equal(authorizePlatformAdminOperation(['PLATFORM_ADMIN', 'FINANCE_ADMIN'], 'MUTATE_SETTLEMENT_ACCOUNT'), 'ALLOW');
});
