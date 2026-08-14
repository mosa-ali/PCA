// PCA-MYKIDS-BILL-2 -- FamilyCommercialService unit tests (no real MySQL
// connection): family scoping / IDOR defense-in-depth, delegation
// correctness, market/currency validation, error mapping, and read-model
// composition (entitlement/subscription/invoices/payment methods).
//
// ChangeRequestService.createRequest/cancel (PCA-PA-2, an accepted file
// this lane composes but never edits) always wraps its own repository
// calls in db/pool.js's REAL `runInTransaction` -- there is no injectable
// seam on that class, and this codebase's own convention is to test it
// ONLY against a real MySQL connection (test/db/*.mysql.test.mjs; see e.g.
// test/db/platformEntitlementsCore.mysql.test.mjs). This file therefore
// stubs `changeRequestService` at the FamilyCommercialService boundary to
// unit-test THIS lane's own logic without a DB. The full real-service,
// real-DB, end-to-end proof of "managed-device targeting validation" /
// "parent-member request never touches QuotePort" / "quote immutability"
// lives in test/db/familyCommercialIntegration.mysql.test.mjs (DB-gated,
// run via `npm run test:db`).
import assert from 'node:assert/strict';
import test from 'node:test';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { FamilyCommercialService, FamilyCommercialError } from '../../dist/familycommercial/FamilyCommercialService.js';
import { createInMemoryEntitlementRepository } from '../support/inMemoryEntitlementRepository.mjs';
import { createInMemoryChangeRequestRepository } from '../support/inMemoryChangeRequestRepository.mjs';
import { createStubChangeRequestService } from '../support/stubChangeRequestService.mjs';

const FIXED_NOW = new Date('2026-06-01T00:00:00Z');

function fakeRunQuery(fn) {
  return fn(undefined);
}

function buildService() {
  const entitlementRepository = createInMemoryEntitlementRepository();
  entitlementRepository._seedDefaults('FREE_STARTER', 1, 1, FIXED_NOW);
  const changeRequestRepository = createInMemoryChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  const stubChangeRequestService = createStubChangeRequestService(changeRequestRepository, () => FIXED_NOW);

  const subscriptionsByFamily = new Map();
  const subscriptionRepository = { async findActiveForAccount(_conn, accountRef) { return subscriptionsByFamily.get(accountRef) ?? null; } };
  const paymentMethodsByFamily = new Map();
  const paymentMethodRepository = { async listForAccount(_conn, accountRef) { return paymentMethodsByFamily.get(accountRef) ?? []; } };
  const invoiceReadRepository = { async listForFamily() { return []; }, async findForFamily() { return null; }, async listLines() { return []; } };

  const service = new FamilyCommercialService(
    entitlementService,
    changeRequestRepository,
    stubChangeRequestService,
    subscriptionRepository,
    paymentMethodRepository,
    invoiceReadRepository,
    () => FIXED_NOW,
    fakeRunQuery,
  );
  return { service, changeRequestRepository, subscriptionsByFamily, paymentMethodsByFamily, stubChangeRequestService };
}

test('getEntitlement returns the family-scoped read model, lazily creating the FREE_STARTER row', async () => {
  const { service } = buildService();
  const model = await service.getEntitlement('family-A');
  assert.equal(model.familyId, 'family-A');
  assert.equal(model.parentMemberLimit, 1);
  assert.equal(model.managedDeviceLimit, 1);
  assert.equal(model.availableDeviceSlots, 1);
});

test('createDeviceIncreaseRequest delegates limitType=MANAGED_DEVICE_LIMIT and the caller-declared target to ChangeRequestService verbatim -- never clamped to a hardcoded allowed-target set', async () => {
  const { service, stubChangeRequestService } = buildService();
  const created = await service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5 });
  assert.equal(created.targetLimit, 5);
  assert.equal(stubChangeRequestService.calls.createRequest.length, 1);
  assert.equal(stubChangeRequestService.calls.createRequest[0].limitType, 'MANAGED_DEVICE_LIMIT');
  assert.equal(stubChangeRequestService.calls.createRequest[0].targetLimit, 5);
});

test('createDeviceIncreaseRequest maps ChangeRequestService INVALID_TARGET to FamilyCommercialError', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: -1 }),
    (err) => err instanceof FamilyCommercialError && err.code === 'INVALID_TARGET',
  );
});

test('createParentMemberIncreaseRequest delegates limitType=PARENT_MEMBER_LIMIT -- FamilyCommercialService itself never imports/references QuotePort or PriceBook at all (structurally cannot touch them)', async () => {
  const { service, stubChangeRequestService } = buildService();
  const created = await service.createParentMemberIncreaseRequest({ familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 4 });
  assert.equal(created.targetLimit, 4);
  assert.equal(stubChangeRequestService.calls.createRequest[0].limitType, 'PARENT_MEMBER_LIMIT');
});

test('an invalid commercialMarket is rejected before ever reaching ChangeRequestService', async () => {
  const { service, stubChangeRequestService } = buildService();
  await assert.rejects(
    () => service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5, commercialMarket: 'MARS' }),
    (err) => err instanceof FamilyCommercialError && err.code === 'INVALID_MARKET',
  );
  assert.equal(stubChangeRequestService.calls.createRequest.length, 0);
});

test('an invalid currencyCode (including EUR) is rejected before ever reaching ChangeRequestService', async () => {
  const { service, stubChangeRequestService } = buildService();
  await assert.rejects(
    () => service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5, currencyCode: 'EUR' }),
    (err) => err instanceof FamilyCommercialError && err.code === 'INVALID_CURRENCY',
  );
  assert.equal(stubChangeRequestService.calls.createRequest.length, 0);
});

test('cross-family IDOR: getRequest for another family\'s request is indistinguishable from NOT_FOUND', async () => {
  const { service, changeRequestRepository } = buildService();
  await changeRequestRepository.create(undefined, { requestId: 'req-x', familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', currentLimitAtRequest: 1, targetLimit: 2, now: FIXED_NOW });
  await assert.rejects(
    () => service.getRequest('family-B', 'req-x'),
    (err) => err instanceof FamilyCommercialError && err.code === 'NOT_FOUND',
  );
  const owned = await service.getRequest('family-A', 'req-x');
  assert.equal(owned.requestId, 'req-x');
});

test('cross-family IDOR: cancelRequest for another family\'s request never reaches ChangeRequestService.cancel, and reports NOT_FOUND', async () => {
  const { service, changeRequestRepository, stubChangeRequestService } = buildService();
  await changeRequestRepository.create(undefined, { requestId: 'req-y', familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', currentLimitAtRequest: 1, targetLimit: 2, now: FIXED_NOW });
  await assert.rejects(
    () => service.cancelRequest('family-B', 'req-y'),
    (err) => err instanceof FamilyCommercialError && err.code === 'NOT_FOUND',
  );
  assert.equal(stubChangeRequestService.calls.cancel.length, 0, 'ChangeRequestService.cancel must never be called for a request the caller does not own');
});

test('listRequests never leaks a request that belongs to a different family', async () => {
  const { service, changeRequestRepository } = buildService();
  await changeRequestRepository.create(undefined, { requestId: 'req-a', familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', currentLimitAtRequest: 1, targetLimit: 2, now: FIXED_NOW });
  await changeRequestRepository.create(undefined, { requestId: 'req-b', familyId: 'family-B', limitType: 'PARENT_MEMBER_LIMIT', currentLimitAtRequest: 1, targetLimit: 2, now: FIXED_NOW });
  const listA = await service.listRequests('family-A');
  assert.equal(listA.length, 1);
  assert.ok(listA.every((r) => r.familyId === 'family-A'));
});

test('subscription read: no billing_subscriptions row => null (mapped to FREE_STARTER at the DTO layer, never fabricated)', async () => {
  const { service } = buildService();
  const subscription = await service.getSubscription('family-A');
  assert.equal(subscription, null);
});

test('subscription read: an active row for a DIFFERENT family is never returned for this family (family-scoped by accountRef)', async () => {
  const { service, subscriptionsByFamily } = buildService();
  subscriptionsByFamily.set('family-B', { subscriptionId: 'sub-1', accountRef: 'family-B', planId: 'plan-1', status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(), paymentMethodId: null, createdAt: new Date(), canceledAt: null });
  assert.equal(await service.getSubscription('family-A'), null);
  const subscriptionB = await service.getSubscription('family-B');
  assert.equal(subscriptionB.subscriptionId, 'sub-1');
});

test('payment method read returns only this family\'s methods', async () => {
  const { service, paymentMethodsByFamily } = buildService();
  paymentMethodsByFamily.set('family-A', [
    { paymentMethodId: 'pm-1', accountRef: 'family-A', provider: 'SANDBOX', providerPaymentMethodRef: 'ref-1', brand: 'VISA', displayLabel: 'Visa •••• 4242', last4: '4242', expiryMonth: 12, expiryYear: 2030, status: 'ACTIVE', createdAt: new Date() },
  ]);
  const methodsA = await service.listPaymentMethods('family-A');
  assert.equal(methodsA.length, 1);
  const methodsB = await service.listPaymentMethods('family-B');
  assert.equal(methodsB.length, 0);
});
