import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizePlatformAdminOperation, PLATFORM_ADMIN_OPERATIONS } from '../../dist/platformadmin/auth/rbacPolicy.js';
import { PLATFORM_ADMIN_ROLES } from '../../dist/platformadmin/auth/types.js';

const VIEW_OPERATIONS = new Set(['VIEW_ADMIN_ACCOUNTS', 'VIEW_PLATFORM_DASHBOARD', 'VIEW_AUDIT_LOG_FULL', 'VIEW_AUDIT_LOG_OWN', 'VIEW_SUPPORT_ACCOUNT_METADATA', 'VIEW_SETTLEMENT_RECORDS']);

test('PCA-ADD-PA-008: AUDITOR_READ_ONLY is DENY on every operation not prefixed VIEW_*, across the whole matrix', () => {
  for (const operation of PLATFORM_ADMIN_OPERATIONS) {
    const verdict = authorizePlatformAdminOperation(['AUDITOR_READ_ONLY'], operation);
    if (VIEW_OPERATIONS.has(operation)) {
      assert.equal(verdict, 'ALLOW', `expected AUDITOR_READ_ONLY ALLOW on ${operation}`);
    } else {
      assert.equal(verdict, 'DENY', `expected AUDITOR_READ_ONLY DENY on ${operation}`);
    }
  }
});

test('every operation has an explicit verdict for every role -- no undefined cell', () => {
  for (const operation of PLATFORM_ADMIN_OPERATIONS) {
    for (const role of PLATFORM_ADMIN_ROLES) {
      const verdict = authorizePlatformAdminOperation([role], operation);
      assert.ok(verdict === 'ALLOW' || verdict === 'DENY');
    }
  }
});

test('an unrecognized operation throws (programming error, never silently permitted)', () => {
  assert.throws(() => authorizePlatformAdminOperation(['APP_OWNER'], 'NOT_A_REAL_OPERATION'));
});

test('an admin with zero active roles is authorized for nothing', () => {
  for (const operation of PLATFORM_ADMIN_OPERATIONS) {
    assert.equal(authorizePlatformAdminOperation([], operation), 'DENY');
  }
});

test('PLATFORM_ADMIN cannot ADMINISTER_BILLING (a FINANCE_ADMIN-only operation)', () => {
  assert.equal(authorizePlatformAdminOperation(['PLATFORM_ADMIN'], 'ADMINISTER_BILLING'), 'DENY');
});

test('FINANCE_ADMIN cannot ASSIGN_ADMIN_ROLE', () => {
  assert.equal(authorizePlatformAdminOperation(['FINANCE_ADMIN'], 'ASSIGN_ADMIN_ROLE'), 'DENY');
});

test('SUPPORT_ADMIN cannot ISSUE_REFUND (a billing-mutation operation)', () => {
  assert.equal(authorizePlatformAdminOperation(['SUPPORT_ADMIN'], 'ISSUE_REFUND'), 'DENY');
});

test('APP_OWNER is ALLOW on every operation', () => {
  for (const operation of PLATFORM_ADMIN_OPERATIONS) {
    assert.equal(authorizePlatformAdminOperation(['APP_OWNER'], operation), 'ALLOW');
  }
});

test('ALLOW if ANY held role permits the operation, even if another held role would deny it', () => {
  assert.equal(authorizePlatformAdminOperation(['AUDITOR_READ_ONLY', 'APP_OWNER'], 'MANAGE_ADMIN_ACCOUNTS'), 'ALLOW');
});
