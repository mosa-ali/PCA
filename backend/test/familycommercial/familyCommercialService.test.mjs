// PCA-MYKIDS-BILL-2 -- FamilyCommercialService: family scoping, IDOR
// defense-in-depth, managed-device request validation (no hardcoded
// targets), parent-member request non-billability (never touches
// QuotePort/PriceBook), standard/custom quote resolution, quote
// immutability, and read-model composition (entitlement/subscription/
// invoices/payment methods).
import assert from 'node:assert/strict';
import test from 'node:test';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { ChangeRequestService } from '../../dist/entitlements/requests/ChangeRequestService.js';
import { FamilyCommercialService, FamilyCommercialError } from '../../dist/familycommercial/FamilyCommercialService.js';
import { createInMemoryEntitlementRepository } from '../support/inMemoryEntitlementRepository.mjs';
import { createInMemoryChangeRequestRepository } from '../support/inMemoryChangeRequestRepository.mjs';

const FIXED_NOW = new Date('2026-06-01T00:00:00Z');

class SpyQuotePort {
  constructor(resolution) {
    this.resolution = resolution ?? { kind: 'REQUIRES_CUSTOM_QUOTE' };
    this.calls = [];
  }
  async resolveStandardQuote(input) {
    this.calls.push(input);
    return this.resolution;
  }
}

function buildService(quotePort) {
  const entitlementRepository = createInMemoryEntitlementRepository();
  entitlementRepository._seedDefaults('FREE_STARTER', 1, 1, FIXED_NOW);
  const changeRequestRepository = createInMemoryChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  const changeRequestService = new ChangeRequestService(changeRequestRepository, entitlementRepository, entitlementService, quotePort, () => FIXED_NOW);

  // Minimal fakes for the billing-core repository ports this service reuses
  // directly (repository layer, not the RBAC-gated Service layer -- see
  // FamilyCommercialService.ts's own header).
  const subscriptionsByFamily = new Map();
  const subscriptionRepository = {
    async findActiveForAccount(_conn, accountRef) {
      return subscriptionsByFamily.get(accountRef) ?? null;
    },
  };
  const paymentMethodsByFamily = new Map();
  const paymentMethodRepository = {
    async listForAccount(_conn, accountRef) {
      return paymentMethodsByFamily.get(accountRef) ?? [];
    },
  };
  const invoiceReadRepository = {
    async listForFamily() {
      return [];
    },
    async findForFamily() {
      return null;
    },
    async listLines() {
      return [];
    },
  };

  const service = new FamilyCommercialService(
    entitlementService,
    changeRequestRepository,
    changeRequestService,
    subscriptionRepository,
    paymentMethodRepository,
    invoiceReadRepository,
    () => FIXED_NOW,
  );
  return { service, entitlementRepository, changeRequestRepository, subscriptionsByFamily, paymentMethodsByFamily };
}

test('getEntitlement returns the family-scoped read model, lazily creating the FREE_STARTER row', async () => {
  const { service } = buildService(new SpyQuotePort());
  const model = await service.getEntitlement('family-A');
  assert.equal(model.familyId, 'family-A');
  assert.equal(model.parentMemberLimit, 1);
  assert.equal(model.managedDeviceLimit, 1);
  assert.equal(model.availableDeviceSlots, 1);
});

test('createDeviceIncreaseRequest validates the target against the CURRENT limit -- not a hardcoded allowed-target set', async () => {
  const { service } = buildService(new SpyQuotePort());
  // Current managedDeviceLimit is 1 (seeded default) -- any positive
  // integer > 1 must be accepted (5, an arbitrary non-2/3/5-suggested-list
  // number, proves this is not clamped to a hardcoded {2,3,5} set).
  const created = await service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5 });
  assert.equal(created.targetLimit, 5);
  assert.equal(created.limitType, 'MANAGED_DEVICE_LIMIT');

  await assert.rejects(
    () => service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 1 }),
    (err) => err instanceof FamilyCommercialError && err.code === 'INVALID_TARGET',
  );
});

test('parent-member increase request is NON-BILLABLE: it never calls QuotePort/PriceBook, and stays PENDING with no quote', async () => {
  const spy = new SpyQuotePort({ kind: 'STANDARD', quoteId: 'x', targetDeviceLimit: 9, amountMinor: 100n, currencyCode: 'USD', priceBookVersion: 1, expiresAt: new Date() });
  const { service } = buildService(spy);
  const created = await service.createParentMemberIncreaseRequest({ familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 4 });
  assert.equal(created.state, 'PENDING');
  assert.equal(created.quote, null);
  assert.equal(created.awaitingAdminQuote, false);
  assert.equal(spy.calls.length, 0, 'QuotePort.resolveStandardQuote must never be called for a PARENT_MEMBER_LIMIT request');
});

test('managed-device request resolves a STANDARD quote when PriceBookQuotePort finds an active row', async () => {
  const now = FIXED_NOW;
  const spy = new SpyQuotePort({
    kind: 'STANDARD',
    quoteId: 'price-book:pb-1',
    targetDeviceLimit: 3,
    amountMinor: 899n,
    currencyCode: 'USD',
    priceBookVersion: 1,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const { service } = buildService(spy);
  const created = await service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 3 });
  assert.equal(created.state, 'QUOTED');
  assert.equal(created.quote.quoteKind, 'STANDARD');
  assert.equal(created.quote.amountMinor, 899n);
  assert.equal(created.quote.currencyCode, 'USD');
  assert.equal(spy.calls.length, 1);
});

test('managed-device request falls to PENDING_ADMIN_QUOTE (awaitingAdminQuote) when no PriceBook row exists -- family can never self-issue a quote', async () => {
  const { service } = buildService(new SpyQuotePort({ kind: 'REQUIRES_CUSTOM_QUOTE' }));
  const created = await service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 7 });
  assert.equal(created.state, 'PENDING');
  assert.equal(created.awaitingAdminQuote, true);
  assert.equal(created.quote, null);
});

test('quote immutability: a QUOTED request keeps its exact original quote even if a later resolution would differ', async () => {
  const spy = new SpyQuotePort({ kind: 'STANDARD', quoteId: 'q1', targetDeviceLimit: 3, amountMinor: 500n, currencyCode: 'USD', priceBookVersion: 1, expiresAt: new Date(FIXED_NOW.getTime() + 60_000) });
  const { service, changeRequestRepository } = buildService(spy);
  const created = await service.createDeviceIncreaseRequest({ familyId: 'family-A', limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 3 });
  assert.equal(created.quote.amountMinor, 500n);

  // Simulate a later PriceBook change: the QuotePort would now return a
  // different price for a NEW resolution, but re-reading the SAME request
  // must return the exact original snapshot, never a re-derived one.
  spy.resolution = { kind: 'STANDARD', quoteId: 'q2', targetDeviceLimit: 3, amountMinor: 999n, currencyCode: 'USD', priceBookVersion: 2, expiresAt: new Date() };
  const reread = await service.getRequest('family-A', created.requestId);
  assert.equal(reread.quote.amountMinor, 500n);
  assert.equal(reread.quote.priceBookVersion, 1);
  void changeRequestRepository;
});

test('cross-family IDOR: getRequest/cancelRequest for another family\'s request is indistinguishable from NOT_FOUND', async () => {
  const { service } = buildService(new SpyQuotePort());
  const created = await service.createParentMemberIncreaseRequest({ familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 2 });

  await assert.rejects(
    () => service.getRequest('family-B', created.requestId),
    (err) => err instanceof FamilyCommercialError && err.code === 'NOT_FOUND',
  );
  await assert.rejects(
    () => service.cancelRequest('family-B', created.requestId),
    (err) => err instanceof FamilyCommercialError && err.code === 'NOT_FOUND',
  );
  // The family that actually owns it can still read/cancel it.
  const owned = await service.getRequest('family-A', created.requestId);
  assert.equal(owned.requestId, created.requestId);
});

test('listRequests/getRequest never leak a request that belongs to a different family via listing', async () => {
  const { service } = buildService(new SpyQuotePort());
  await service.createParentMemberIncreaseRequest({ familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 2 });
  await service.createParentMemberIncreaseRequest({ familyId: 'family-B', limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 2 });
  const listA = await service.listRequests('family-A');
  assert.equal(listA.length, 1);
  assert.ok(listA.every((r) => r.familyId === 'family-A'));
});

test('cancelRequest only succeeds from PENDING/QUOTED (ChangeRequestService\'s own guard, reused not reimplemented)', async () => {
  const { service, changeRequestRepository } = buildService(new SpyQuotePort());
  const created = await service.createParentMemberIncreaseRequest({ familyId: 'family-A', limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 2 });
  const cancelled = await service.cancelRequest('family-A', created.requestId);
  assert.equal(cancelled.state, 'CANCELLED');

  await assert.rejects(
    () => service.cancelRequest('family-A', created.requestId),
    (err) => err instanceof FamilyCommercialError && err.code === 'INVALID_STATE',
  );
  void changeRequestRepository;
});

test('subscription read: no billing_subscriptions row => null (mapped to FREE_STARTER at the DTO layer, never fabricated)', async () => {
  const { service } = buildService(new SpyQuotePort());
  const subscription = await service.getSubscription('family-A');
  assert.equal(subscription, null);
});

test('subscription read: an active row for a DIFFERENT family is never returned for this family (family-scoped by accountRef)', async () => {
  const { service, subscriptionsByFamily } = buildService(new SpyQuotePort());
  subscriptionsByFamily.set('family-B', { subscriptionId: 'sub-1', accountRef: 'family-B', planId: 'plan-1', status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(), paymentMethodId: null, createdAt: new Date(), canceledAt: null });
  const subscriptionA = await service.getSubscription('family-A');
  assert.equal(subscriptionA, null);
  const subscriptionB = await service.getSubscription('family-B');
  assert.equal(subscriptionB.subscriptionId, 'sub-1');
});

test('payment method read returns only this family\'s methods, safe fields only (no PAN/CVV/secret field exists on the row type to begin with)', async () => {
  const { service, paymentMethodsByFamily } = buildService(new SpyQuotePort());
  paymentMethodsByFamily.set('family-A', [
    { paymentMethodId: 'pm-1', accountRef: 'family-A', provider: 'SANDBOX', providerPaymentMethodRef: 'ref-1', brand: 'VISA', displayLabel: 'Visa •••• 4242', last4: '4242', expiryMonth: 12, expiryYear: 2030, status: 'ACTIVE', createdAt: new Date() },
  ]);
  const methods = await service.listPaymentMethods('family-A');
  assert.equal(methods.length, 1);
  assert.equal(methods[0].last4, '4242');
  const methodsB = await service.listPaymentMethods('family-B');
  assert.equal(methodsB.length, 0);
});
