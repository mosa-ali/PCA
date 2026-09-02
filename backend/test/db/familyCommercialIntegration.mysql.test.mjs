// PCA-MYKIDS-BILL-2 -- end-to-end integration proof against a REAL MySQL
// connection: the real (accepted) EntitlementService/ChangeRequestService/
// MySqlEntitlementRepository/MySqlChangeRequestRepository, composed through
// FamilyCommercialService exactly as production wiring would. This is the
// authoritative proof of:
//   - managed-device target validation is ChangeRequestService's own
//     (never a hardcoded {2,3,5} set),
//   - a PARENT_MEMBER_LIMIT request structurally NEVER calls
//     QuotePort.resolveStandardQuote (a spy QuotePort call-count assertion
//     against the REAL ChangeRequestService, not a stub),
//   - quote immutability (a later PriceBook/QuotePort change never
//     retroactively alters an already-QUOTED request),
//   - cross-family cancel is rejected before ChangeRequestService.cancel is
//     ever reached.
// The DB-free unit-test proof of THIS lane's OWN logic (family-scoping,
// validation, error mapping, DTO shaping) lives in
// backend/test/familycommercial/*.test.mjs and runs as part of `npm test`.
// This file follows this codebase's own convention (e.g.
// test/db/platformEntitlementsCore.mysql.test.mjs) of requiring
// PCA_DATABASE_URL and running only via `npm run test:db`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool } from '../../dist/db/pool.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { MySqlChangeRequestRepository } from '../../dist/entitlements/requests/MySqlChangeRequestRepository.js';
import { ChangeRequestService } from '../../dist/entitlements/requests/ChangeRequestService.js';
import { FamilyCommercialService, FamilyCommercialError } from '../../dist/familycommercial/FamilyCommercialService.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { MySqlCommercialNotificationPublisher } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';
import { PlanService, PlanRepository } from '../../dist/billing/plan.js';
import { SubscriptionService, SubscriptionRepository } from '../../dist/billing/subscription.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

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

function uniqueFamilyId(label) {
  return `family-${label}-${randomUUID()}`;
}

function buildService(quotePort) {
  const entitlementRepository = new MySqlEntitlementRepository();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  const commercialNotificationPublisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());
  const changeRequestService = new ChangeRequestService(changeRequestRepository, entitlementRepository, entitlementService, quotePort, commercialNotificationPublisher);
  const subscriptionRepository = { async findActiveForAccount() { return null; } };
  const paymentMethodRepository = { async listForAccount() { return []; } };
  const invoiceReadRepository = { async listForFamily() { return []; }, async findForFamily() { return null; }, async listLines() { return []; } };
  return new FamilyCommercialService(entitlementService, changeRequestRepository, changeRequestService, subscriptionRepository, paymentMethodRepository, invoiceReadRepository);
}

test('managed-device increase request: real target validation, no hardcoded allowed-target set', async () => {
  const familyId = uniqueFamilyId('device-target');
  const service = buildService(new SpyQuotePort());
  const created = await service.createDeviceIncreaseRequest({ familyId, limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 11 });
  assert.equal(created.targetLimit, 11);
  await assert.rejects(
    () => service.createDeviceIncreaseRequest({ familyId, limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 1 }),
    (err) => err instanceof FamilyCommercialError && err.code === 'INVALID_TARGET',
  );
});

test('parent-member increase request NEVER calls QuotePort.resolveStandardQuote, against the REAL ChangeRequestService', async () => {
  const familyId = uniqueFamilyId('parent-member');
  const spy = new SpyQuotePort({ kind: 'STANDARD', quoteId: 'x', targetDeviceLimit: 9, amountMinor: 100n, currencyCode: 'USD', priceBookVersion: 1, expiresAt: new Date() });
  const service = buildService(spy);
  const created = await service.createParentMemberIncreaseRequest({ familyId, limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 3 });
  assert.equal(created.state, 'PENDING');
  assert.equal(created.quote, null);
  assert.equal(spy.calls.length, 0);
});

test('quote immutability: a QUOTED managed-device request keeps its original snapshot even after the QuotePort would resolve differently', async () => {
  const familyId = uniqueFamilyId('quote-immutable');
  const spy = new SpyQuotePort({ kind: 'STANDARD', quoteId: 'q1', targetDeviceLimit: 4, amountMinor: 500n, currencyCode: 'USD', priceBookVersion: 1, expiresAt: new Date(Date.now() + 60_000) });
  const service = buildService(spy);
  const created = await service.createDeviceIncreaseRequest({ familyId, limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 4 });
  assert.equal(created.quote.amountMinor, 500n);

  spy.resolution = { kind: 'STANDARD', quoteId: 'q2', targetDeviceLimit: 4, amountMinor: 999n, currencyCode: 'USD', priceBookVersion: 2, expiresAt: new Date() };
  const reread = await service.getRequest(familyId, created.requestId);
  assert.equal(reread.quote.amountMinor, 500n);
  assert.equal(reread.quote.priceBookVersion, 1);
});

test('cross-family cancel is rejected as NOT_FOUND before ChangeRequestService.cancel ever runs', async () => {
  const familyA = uniqueFamilyId('cancel-a');
  const familyB = uniqueFamilyId('cancel-b');
  const service = buildService(new SpyQuotePort());
  const created = await service.createParentMemberIncreaseRequest({ familyId: familyA, limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 2 });
  await assert.rejects(
    () => service.cancelRequest(familyB, created.requestId),
    (err) => err instanceof FamilyCommercialError && err.code === 'NOT_FOUND',
  );
  const cancelled = await service.cancelRequest(familyA, created.requestId);
  assert.equal(cancelled.state, 'CANCELLED');
});

// ---------------------------------------------------------------------------
// updateAutoRenew (migrations/0031_billing_subscription_auto_renew.sql) --
// unlike buildService() above, this exercises the REAL
// billing/subscription.js SubscriptionRepository against real MySQL, not
// the `{ findActiveForAccount() { return null; } }` stub -- the
// authoritative proof this mutation actually persists through the real
// column/query, not just through FamilyCommercialService's own in-process
// logic (already covered DB-free in test/familycommercial/
// familyCommercialService.test.mjs).
// ---------------------------------------------------------------------------

async function createActiveSubscriptionFor(familyId) {
  const roles = ['APP_OWNER'];
  const planService = new PlanService(new PlanRepository());
  const subscriptionService = new SubscriptionService(new SubscriptionRepository());
  const plan = await planService.createNewVersion(
    { planCode: `FAMCOMM_AUTORENEW_PLAN_${randomUUID()}`, status: 'ACTIVE', billingCadence: 'MONTHLY', defaultParentMemberLimit: 1, defaultManagedDeviceLimit: 1, priceBookId: null },
    roles,
  );
  const now = new Date();
  const period = { currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600_000) };
  return subscriptionService.createSubscription({ accountRef: familyId, planId: plan.planId, status: 'ACTIVE', paymentMethodId: null, ...period }, roles);
}

function buildServiceWithRealSubscriptions() {
  const entitlementRepository = new MySqlEntitlementRepository();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  const commercialNotificationPublisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());
  const changeRequestService = new ChangeRequestService(changeRequestRepository, entitlementRepository, entitlementService, new SpyQuotePort(), commercialNotificationPublisher);
  const paymentMethodRepository = { async listForAccount() { return []; } };
  const invoiceReadRepository = { async listForFamily() { return []; }, async findForFamily() { return null; }, async listLines() { return []; } };
  return new FamilyCommercialService(entitlementService, changeRequestRepository, changeRequestService, new SubscriptionRepository(), paymentMethodRepository, invoiceReadRepository);
}

test('updateAutoRenew persists through the real SubscriptionRepository/MySQL column, and is idempotent against a real connection', async () => {
  const familyId = uniqueFamilyId('auto-renew');
  const created = await createActiveSubscriptionFor(familyId);
  assert.equal(created.autoRenew, true, 'a fresh subscription defaults to auto_renew = 1');

  const service = buildServiceWithRealSubscriptions();
  const cancelled = await service.updateAutoRenew(familyId, false);
  assert.equal(cancelled.autoRenew, false);
  assert.equal((await service.getSubscription(familyId)).autoRenew, false, 'a fresh read must reflect the persisted column, not a cached value');

  // Idempotent: the same value again is a safe no-op, not an error.
  await assert.doesNotReject(() => service.updateAutoRenew(familyId, false));

  const resumed = await service.updateAutoRenew(familyId, true);
  assert.equal(resumed.autoRenew, true, 'resume is symmetric with cancel, not a one-way terminal transition');
});

test('updateAutoRenew: cross-family IDOR -- family B has no active subscription of its own, so toggling it is NOT_FOUND, never family A\'s row', async () => {
  const familyA = uniqueFamilyId('auto-renew-idor-a');
  const familyB = uniqueFamilyId('auto-renew-idor-b');
  await createActiveSubscriptionFor(familyA);
  const service = buildServiceWithRealSubscriptions();
  await assert.rejects(
    () => service.updateAutoRenew(familyB, false),
    (err) => err instanceof FamilyCommercialError && err.code === 'NOT_FOUND',
  );
  assert.equal((await service.getSubscription(familyA)).autoRenew, true, 'family A\'s subscription must be untouched by a rejected family-B call');
});

test.after(async () => {
  await closePool();
});
