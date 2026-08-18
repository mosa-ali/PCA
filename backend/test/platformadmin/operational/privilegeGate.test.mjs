/**
 * PCA-PA-3B -- object-authorization tests for this lane's HTTP surface
 * (mission Section 21). Every route in this lane composes
 * `authorizePlatformAdminOperation` (backend/src/platformadmin/auth/rbacPolicy.ts)
 * or `requireBillingOperation` (backend/src/billing/rbac.ts) verbatim,
 * never a re-derived/parallel matrix -- so asserting the exact matrix
 * cells each route depends on is equivalent to testing that route's
 * server-side authorization decision (code-reviewed 1:1 against the route
 * source below). This test never edits or loosens either matrix; it only
 * pins the specific cells this lane's routes rely on so a future change to
 * either matrix that would silently change this lane's authorization
 * behavior fails loudly here too.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizePlatformAdminOperation } from '../../../dist/platformadmin/auth/rbacPolicy.js';
import { authorizeBillingOperation } from '../../../dist/billing/rbac.js';

// Mission Section 21 scenario: wrong Platform Admin role denied on a
// representative mutating operation from every domain this lane exposes.
test('wrong-role denial: PLATFORM_ADMIN cannot administer billing (price book / plans / custom quotes)', () => {
  assert.equal(authorizePlatformAdminOperation(['PLATFORM_ADMIN'], 'ADMINISTER_BILLING'), 'DENY');
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'MUTATE_PRICE_BOOK'), 'DENY');
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'ADMINISTER_BILLING_RECORDS'), 'DENY');
});

// Mission Section 21 scenario: AUDITOR_READ_ONLY cannot mutate anything
// this lane's routes gate, on any domain.
test('AUDITOR_READ_ONLY is denied on every mutating operation this lane exposes', () => {
  const mutatingOperations = [
    'MANAGE_ADMIN_ACCOUNTS',
    'ASSIGN_ADMIN_ROLE',
    'SUSPEND_FAMILY_ACCOUNT',
    'REACTIVATE_FAMILY_ACCOUNT',
    'ADMINISTER_ENTITLEMENT_QUANTITY',
    'ADMINISTER_BILLING',
    'ISSUE_REFUND',
    'ADMINISTER_SETTLEMENT',
    'ADMINISTER_SENSITIVE_PLATFORM_SETTINGS',
    'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS',
  ];
  for (const op of mutatingOperations) {
    assert.equal(authorizePlatformAdminOperation(['AUDITOR_READ_ONLY'], op), 'DENY', `AUDITOR_READ_ONLY unexpectedly ALLOWed for ${op}`);
  }
  const billingMutations = ['MUTATE_PRICE_BOOK', 'ISSUE_QUOTE', 'ADMINISTER_BILLING_RECORDS', 'ISSUE_REFUND', 'ADMINISTER_DISPUTE'];
  for (const op of billingMutations) {
    assert.equal(authorizeBillingOperation(['AUDITOR_READ_ONLY'], op), 'DENY', `AUDITOR_READ_ONLY unexpectedly ALLOWed for billing ${op}`);
  }
});

// Mission Section 21 scenario: SUPPORT_ADMIN gets no finance/billing access
// of any kind -- this lane's billingReadRoutes.ts and priceBookRoutes.ts
// gate on requireBillingOperation, which SUPPORT_ADMIN fails for every cell.
test('SUPPORT_ADMIN has zero billing-read/mutation access (finance domain is FINANCE_ADMIN-only)', () => {
  const allBillingOps = ['VIEW_PRICE_BOOK', 'MUTATE_PRICE_BOOK', 'ISSUE_QUOTE', 'VIEW_BILLING_RECORDS', 'ADMINISTER_BILLING_RECORDS', 'VIEW_PAYMENT_INSTRUMENTS', 'ISSUE_REFUND', 'ADMINISTER_DISPUTE'];
  for (const op of allBillingOps) {
    assert.equal(authorizeBillingOperation(['SUPPORT_ADMIN'], op), 'DENY', `SUPPORT_ADMIN unexpectedly ALLOWed for ${op}`);
  }
  assert.equal(authorizePlatformAdminOperation(['SUPPORT_ADMIN'], 'ADMINISTER_BILLING'), 'DENY');
  assert.equal(authorizePlatformAdminOperation(['SUPPORT_ADMIN'], 'ISSUE_REFUND'), 'DENY');
});

// Mission Section 21 scenario: PLATFORM_ADMIN cannot access refund
// issuance (billingReadRoutes.ts's listRefunds is a VIEW_BILLING_RECORDS
// read, and PLATFORM_ADMIN is DENY there too -- PLATFORM_ADMIN gets ONLY
// VIEW_PRICE_BOOK in the entire billing domain).
test('PLATFORM_ADMIN has no refund issuance or refund-read access', () => {
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'ISSUE_REFUND'), 'DENY');
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'VIEW_BILLING_RECORDS'), 'DENY');
  assert.equal(authorizeBillingOperation(['PLATFORM_ADMIN'], 'VIEW_PRICE_BOOK'), 'ALLOW');
});

test('dashboard financial redaction follows the existing Billing and Settlement read authorities', () => {
  const billingAndSettlementReaders = ['APP_OWNER', 'FINANCE_ADMIN', 'AUDITOR_READ_ONLY'];
  const operationalOnlyReaders = ['PLATFORM_ADMIN', 'SUPPORT_ADMIN'];

  for (const role of billingAndSettlementReaders) {
    assert.equal(authorizeBillingOperation([role], 'VIEW_BILLING_RECORDS'), 'ALLOW', `${role} should receive aggregate billing summaries`);
    assert.equal(authorizePlatformAdminOperation([role], 'VIEW_SETTLEMENT_RECORDS'), 'ALLOW', `${role} should receive settlement summaries`);
  }
  for (const role of operationalOnlyReaders) {
    assert.equal(authorizeBillingOperation([role], 'VIEW_BILLING_RECORDS'), 'DENY', `${role} must not receive aggregate billing summaries`);
    assert.equal(authorizePlatformAdminOperation([role], 'VIEW_SETTLEMENT_RECORDS'), 'DENY', `${role} must not receive settlement summaries`);
  }
});

// Mission Section 21 scenario: FINANCE_ADMIN cannot mutate Platform
// Administration operator-role assignments (adminUserRoutes.ts's
// role-grant/revoke/create/disable/reactivate/session-revoke-all endpoints
// all gate on MANAGE_ADMIN_ACCOUNTS/ASSIGN_ADMIN_ROLE, APP_OWNER-only).
test('FINANCE_ADMIN cannot manage or assign Platform Administration operator roles', () => {
  assert.equal(authorizePlatformAdminOperation(['FINANCE_ADMIN'], 'MANAGE_ADMIN_ACCOUNTS'), 'DENY');
  assert.equal(authorizePlatformAdminOperation(['FINANCE_ADMIN'], 'ASSIGN_ADMIN_ROLE'), 'DENY');
  assert.equal(authorizePlatformAdminOperation(['FINANCE_ADMIN'], 'VIEW_ADMIN_ACCOUNTS'), 'DENY');
});

// Every list/read route this lane exposes uses VIEW_SUPPORT_ACCOUNT_METADATA
// or VIEW_PLATFORM_DASHBOARD or VIEW_AUDIT_LOG_OWN, all ALLOW for every
// role per Section 3.7 -- confirms no role is locked out of read visibility
// this lane intends to be broadly readable.
test('every role retains read access to accounts/dashboard/audit (broad-read operations)', () => {
  const roles = ['APP_OWNER', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY'];
  for (const role of roles) {
    assert.equal(authorizePlatformAdminOperation([role], 'VIEW_SUPPORT_ACCOUNT_METADATA'), 'ALLOW', `${role} should retain VIEW_SUPPORT_ACCOUNT_METADATA`);
    assert.equal(authorizePlatformAdminOperation([role], 'VIEW_PLATFORM_DASHBOARD'), 'ALLOW', `${role} should retain VIEW_PLATFORM_DASHBOARD`);
    assert.equal(authorizePlatformAdminOperation([role], 'VIEW_AUDIT_LOG_OWN'), 'ALLOW', `${role} should retain VIEW_AUDIT_LOG_OWN`);
  }
});

test('an admin with zero active roles (e.g. immediately after their last role was revoked) is authorized for nothing this lane exposes', () => {
  assert.equal(authorizePlatformAdminOperation([], 'VIEW_SUPPORT_ACCOUNT_METADATA'), 'DENY');
  assert.equal(authorizePlatformAdminOperation([], 'ADMINISTER_ENTITLEMENT_QUANTITY'), 'DENY');
  assert.equal(authorizeBillingOperation([], 'VIEW_BILLING_RECORDS'), 'DENY');
});
