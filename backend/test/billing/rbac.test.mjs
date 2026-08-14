import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeBillingOperation, requireBillingOperation, BILLING_OPERATIONS, BillingAuthorizationError } from '../../dist/billing/rbac.js';
import { PLATFORM_ADMIN_ROLES } from '../../dist/platformadmin/auth/types.js';

// Constraint 28: explicit server-side authorization tests for every
// role x capability combination, not just the happy path -- the full
// matrix, transcribed from Section 3.7 / PCA-ADD-BILL-044 of the addendum.
const EXPECTED = {
  VIEW_PRICE_BOOK: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'ALLOW', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  MUTATE_PRICE_BOOK: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  ISSUE_QUOTE: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  VIEW_BILLING_RECORDS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  ADMINISTER_BILLING_RECORDS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  VIEW_PAYMENT_INSTRUMENTS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  ISSUE_REFUND: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  ADMINISTER_DISPUTE: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
};

test('every declared BillingOperation has an entry in the expected matrix (test completeness guard)', () => {
  assert.deepEqual([...BILLING_OPERATIONS].sort(), Object.keys(EXPECTED).sort());
});

test('full role x capability matrix matches Section 3.7 / PCA-ADD-BILL-044 exactly', () => {
  for (const operation of BILLING_OPERATIONS) {
    for (const role of PLATFORM_ADMIN_ROLES) {
      const expected = EXPECTED[operation][role];
      const actual = authorizeBillingOperation([role], operation);
      assert.equal(actual, expected, `${role} x ${operation}: expected ${expected}, got ${actual}`);
    }
  }
});

test('PLATFORM_ADMIN gets read-only price visibility only -- no mutation, no payment-instrument visibility', () => {
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'VIEW_PRICE_BOOK'), 'ALLOW');
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'MUTATE_PRICE_BOOK'), 'DENY');
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'VIEW_PAYMENT_INSTRUMENTS'), 'DENY');
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'ISSUE_REFUND'), 'DENY');
});

test('SUPPORT_ADMIN gets no billing mutation and no payment-instrument visibility -- DENY on every billing operation', () => {
  for (const operation of BILLING_OPERATIONS) {
    assert.equal(authorizeBillingOperation(['SUPPORT_ADMIN'], operation), 'DENY', operation);
  }
});

test('AUDITOR_READ_ONLY is read-only: ALLOW on every VIEW_* operation, DENY on every mutating operation', () => {
  for (const operation of BILLING_OPERATIONS) {
    const verdict = authorizeBillingOperation(['AUDITOR_READ_ONLY'], operation);
    if (operation.startsWith('VIEW_')) assert.equal(verdict, 'ALLOW', operation);
    else assert.equal(verdict, 'DENY', operation);
  }
});

test('APP_OWNER and FINANCE_ADMIN have full billing mutation authority', () => {
  for (const operation of BILLING_OPERATIONS) {
    assert.equal(authorizeBillingOperation(['APP_OWNER'], operation), 'ALLOW', operation);
    assert.equal(authorizeBillingOperation(['FINANCE_ADMIN'], operation), 'ALLOW', operation);
  }
});

test('an admin with zero active roles is authorized for nothing', () => {
  for (const operation of BILLING_OPERATIONS) {
    assert.equal(authorizeBillingOperation([], operation), 'DENY');
  }
});

test('ALLOW if ANY held role permits the operation', () => {
  assert.equal(authorizeBillingOperation(['SUPPORT_ADMIN', 'FINANCE_ADMIN'], 'ISSUE_REFUND'), 'ALLOW');
});

test('an unrecognized operation throws rather than silently denying/allowing', () => {
  assert.throws(() => authorizeBillingOperation(['APP_OWNER'], 'NOT_A_REAL_OPERATION'));
});

test('requireBillingOperation throws BillingAuthorizationError on DENY and returns void on ALLOW', () => {
  assert.throws(() => requireBillingOperation(['SUPPORT_ADMIN'], 'ISSUE_REFUND'), BillingAuthorizationError);
  assert.doesNotThrow(() => requireBillingOperation(['APP_OWNER'], 'ISSUE_REFUND'));
});
