// PCA-ADD-COMP-014: asserts the frozen role matrix for the two new
// complimentary-grant operations directly against
// backend/src/platformadmin/auth/rbacPolicy.ts's OPERATION_MATRIX, the
// same "iterate the real matrix, don't eyeball the table" discipline
// backend/test/platformadmin/rbacPolicy.test.mjs already documents for the
// pre-existing operations. This is a NEW file (never edits the existing
// shared rbacPolicy.test.mjs) so it cannot conflict with any other lane's
// assertions against that file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizePlatformAdminOperation, PLATFORM_ADMIN_OPERATIONS } from '../../dist/platformadmin/auth/rbacPolicy.js';

const ROLES = ['APP_OWNER', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY'];

test('ADMINISTER_COMPLIMENTARY_GRANT is registered in the closed operation set', () => {
  assert.ok(PLATFORM_ADMIN_OPERATIONS.includes('ADMINISTER_COMPLIMENTARY_GRANT'));
  assert.ok(PLATFORM_ADMIN_OPERATIONS.includes('ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT'));
});

test('ADMINISTER_COMPLIMENTARY_GRANT: ALLOW only for APP_OWNER and PLATFORM_ADMIN', () => {
  const expected = { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'ALLOW', FINANCE_ADMIN: 'DENY', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' };
  for (const role of ROLES) {
    assert.equal(authorizePlatformAdminOperation([role], 'ADMINISTER_COMPLIMENTARY_GRANT'), expected[role], `role ${role}`);
  }
});

test('ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT: ALLOW only for APP_OWNER', () => {
  const expected = { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'DENY', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' };
  for (const role of ROLES) {
    assert.equal(authorizePlatformAdminOperation([role], 'ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT'), expected[role], `role ${role}`);
  }
});

test('an admin with zero roles is authorized for neither operation', () => {
  assert.equal(authorizePlatformAdminOperation([], 'ADMINISTER_COMPLIMENTARY_GRANT'), 'DENY');
  assert.equal(authorizePlatformAdminOperation([], 'ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT'), 'DENY');
});

test('VIEW_SUPPORT_ACCOUNT_METADATA (used for complimentary-grant reads) remains ALLOW for all five roles', () => {
  for (const role of ROLES) {
    assert.equal(authorizePlatformAdminOperation([role], 'VIEW_SUPPORT_ACCOUNT_METADATA'), 'ALLOW', `role ${role}`);
  }
});
