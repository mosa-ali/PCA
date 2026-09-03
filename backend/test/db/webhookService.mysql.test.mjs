// PCA-ADD-BILL-032/033/034: real-MySQL proof of WebhookService's three
// core trust-boundary properties (Section 13/14) -- previously completely
// untested (confirmed by a full-repo audit this session: no test anywhere
// called processWebhook/processRecordedEvent). Uses a FAKE PaymentProvider
// only for verifyWebhook/queryPayment (the two hooks a real, unreviewed
// provider adapter would supply -- PCA-BILL-2 is externally blocked on
// PAYMENT_PROVIDER_SELECTION, so no real adapter exists to test against)
// -- every other collaborator (ProviderEventService, PaymentService,
// PlatformAdminAuditService) is the real, MySQL-backed production class.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ef'.repeat(32);

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { PaymentRepository, PaymentService } from '../../dist/billing/payment.js';
import { PriceBookRepository } from '../../dist/billing/priceBook.js';
import { QuoteRepository, QuoteService } from '../../dist/billing/quote.js';
import { money } from '../../dist/billing/money.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { ProviderEventService, ProviderEventRepository } from '../../dist/billing/providerEvent.js';
import { PaymentProviderRegistry } from '../../dist/billing/provider/providerRegistry.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { MySqlCommercialNotificationPublisher } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';
import { WebhookService, WEBHOOK_FRESHNESS_WINDOW_MS } from '../../dist/billing/webhook/WebhookService.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const priceBookRepository = new PriceBookRepository();
const quoteRepository = new QuoteRepository();
const platformAdminAuditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
const quoteService = new QuoteService(priceBookRepository, quoteRepository, platformAdminAuditService);
const paymentRepository = new PaymentRepository();
const paymentService = new PaymentService(paymentRepository, quoteService, platformAdminAuditService);
const providerEventRepository = new ProviderEventRepository();
const providerEventService = new ProviderEventService(providerEventRepository);
const commercialNotificationPublisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());

const NEVER_CALLED_CONFIRMATION_PORT = {
  async confirmPayment() {
    throw new Error('not expected to be called -- test attempts never carry an increaseRequestRef');
  },
};

/** A fake PaymentProvider whose verifyWebhook/queryPayment are fully test-controlled -- see this file's own header for why. */
function fakeProvider(providerName, { queryResult, verifyResult } = {}) {
  return {
    providerName,
    async createCheckout() {
      throw new Error('not used in this test file');
    },
    async verifyWebhook() {
      return verifyResult ?? { verified: true, providerEventId: randomUUID() };
    },
    async queryPayment() {
      if (!queryResult) throw new Error('queryResult not configured for this test');
      return queryResult;
    },
  };
}

function buildWebhookService(provider, now = () => new Date()) {
  const registry = new PaymentProviderRegistry();
  registry.register(provider);
  return new WebhookService(
    registry,
    providerEventService,
    providerEventRepository,
    paymentService,
    NEVER_CALLED_CONFIRMATION_PORT,
    platformAdminAuditService,
    commercialNotificationPublisher,
    now,
  );
}

async function seedPendingAttempt(provider, providerPaymentRef, amountMinor, currencyCode = 'USD') {
  const attempt = await paymentService.createAttemptFromSnapshot(
    { accountRef: `account-${randomUUID()}`, invoiceId: null, increaseRequestRef: null, paymentMethodId: null },
    { targetDeviceLimit: 5, price: money(amountMinor, currencyCode), priceBookId: null, priceBookVersion: null, quoteId: null, quotedAt: new Date(), expiresAt: null },
  );
  // Real checkout flow sets provider/provider_reference at PENDING (before
  // any webhook is ever received) -- mirrored here directly against the
  // same table/columns CheckoutService writes, since this file is testing
  // WebhookService, not CheckoutService's own checkout-session creation.
  await getPool().query(`UPDATE billing_payment_attempts SET status = 'PENDING', provider = ?, provider_reference = ? WHERE payment_attempt_id = ?`, [
    provider,
    providerPaymentRef,
    attempt.paymentAttemptId,
  ]);
  return attempt.paymentAttemptId;
}

async function lastAnomalyReasonFor(paymentAttemptId) {
  const [rows] = await getPool().query(
    `SELECT metadata_json FROM platform_admin_audit_events WHERE event_type = 'PAYMENT_ROLLED_BACK' AND target_ref = ? ORDER BY occurred_at DESC LIMIT 1`,
    [`payment_attempt:${paymentAttemptId}`],
  );
  if (rows.length === 0) return null;
  const metadata = typeof rows[0].metadata_json === 'string' ? JSON.parse(rows[0].metadata_json) : rows[0].metadata_json;
  return metadata.reason;
}

// --- PCA-ADD-BILL-032: replay/freshness window ---

test('MySQL: a webhook payload timestamped outside the freshness window is REJECTED before the idempotency claim is ever made', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerEventId = randomUUID();
  const staleTimestamp = new Date(Date.now() - WEBHOOK_FRESHNESS_WINDOW_MS - 60_000).toISOString();
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef: 'ref-x', timestamp: staleTimestamp }));
  const service = buildWebhookService(fakeProvider(providerName, { verifyResult: { verified: true, providerEventId } }));

  const result = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(result.outcome, 'REJECTED');
  assert.equal(result.httpStatus, 401);

  // The event id must never have been claimed -- a genuinely fresh
  // redelivery of the SAME event id later must not be blocked by this
  // rejected, stale attempt.
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_provider_events WHERE provider = ? AND provider_event_id = ?`, [providerName, providerEventId]);
  assert.equal(Number(rows[0].n), 0, 'a stale/replayed event must never claim the idempotency slot');
});

test('MySQL: a fresh redelivery of the SAME event id after a stale rejection is processed normally (never permanently blocked)', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerEventId = randomUUID();
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 1000n);
  const staleTimestamp = new Date(Date.now() - WEBHOOK_FRESHNESS_WINDOW_MS - 60_000).toISOString();

  const service = buildWebhookService(
    fakeProvider(providerName, {
      verifyResult: { verified: true, providerEventId },
      queryResult: { providerPaymentRef, status: 'CONFIRMED', amountMinor: 1000n, currencyCode: 'USD' },
    }),
  );

  const stalePayload = Buffer.from(JSON.stringify({ providerPaymentRef, timestamp: staleTimestamp }));
  const staleResult = await service.processWebhook(providerName, stalePayload, 'sig');
  assert.equal(staleResult.outcome, 'REJECTED');

  const freshPayload = Buffer.from(JSON.stringify({ providerPaymentRef }));
  const freshResult = await service.processWebhook(providerName, freshPayload, 'sig');
  assert.equal(freshResult.outcome, 'ACK');
  assert.equal(freshResult.httpStatus, 200);

  const [rows] = await getPool().query(`SELECT status FROM billing_payment_attempts WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  assert.equal(rows[0].status, 'CONFIRMED');
});

test('MySQL: a duplicate/redelivered event id is idempotent -- business logic never re-runs a second time', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerEventId = randomUUID();
  const providerPaymentRef = `pay-${randomUUID()}`;
  await seedPendingAttempt(providerName, providerPaymentRef, 1000n);

  const service = buildWebhookService(
    fakeProvider(providerName, {
      verifyResult: { verified: true, providerEventId },
      queryResult: { providerPaymentRef, status: 'CONFIRMED', amountMinor: 1000n, currencyCode: 'USD' },
    }),
  );
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef }));

  const first = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(first.outcome, 'ACK');
  const second = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(second.outcome, 'ACK');

  const [txRows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_transactions WHERE payment_attempt_id = (SELECT payment_attempt_id FROM billing_payment_attempts WHERE provider_reference = ?)`, [providerPaymentRef]);
  assert.equal(Number(txRows[0].n), 1, 'a redelivered event must never create a second transaction row');
});

// --- PCA-ADD-BILL-033: out-of-order delivery / queryPayment authority ---

test('MySQL: the webhook payload\'s own claimed status is NEVER trusted -- only provider.queryPayment\'s authoritative answer decides the outcome', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 1000n);

  // The payload body claims CONFIRMED, but the fake provider's
  // authoritative queryPayment says FAILED -- queryPayment must win.
  const service = buildWebhookService(
    fakeProvider(providerName, {
      verifyResult: { verified: true, providerEventId: randomUUID() },
      queryResult: { providerPaymentRef, status: 'FAILED', amountMinor: 1000n, currencyCode: 'USD' },
    }),
  );
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef, status: 'CONFIRMED' }));

  const result = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(result.outcome, 'ACK');

  const [rows] = await getPool().query(`SELECT status FROM billing_payment_attempts WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  assert.equal(rows[0].status, 'FAILED', 'queryPayment (authoritative) must win over the payload\'s own claimed status');
});

test('MySQL: an out-of-order/unknown provider payment reference is IGNORED, never crashes or fabricates an attempt', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const unknownRef = `unknown-${randomUUID()}`;
  const service = buildWebhookService(
    fakeProvider(providerName, {
      verifyResult: { verified: true, providerEventId: randomUUID() },
      queryResult: { providerPaymentRef: unknownRef, status: 'CONFIRMED', amountMinor: 1000n, currencyCode: 'USD' },
    }),
  );
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef: unknownRef }));

  const result = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(result.outcome, 'ACK');
  assert.equal(result.httpStatus, 200);

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_provider_events WHERE processing_status = 'IGNORED' AND provider = ?`, [providerName]);
  assert.equal(Number(rows[0].n), 1);
});

// --- PCA-ADD-BILL-034: amount/currency cross-check ---

test('MySQL: an amount mismatch between queryPayment and the attempt\'s own snapshotted price is IGNORED and audited, never silently confirmed', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 1000n);

  const service = buildWebhookService(
    fakeProvider(providerName, {
      verifyResult: { verified: true, providerEventId: randomUUID() },
      queryResult: { providerPaymentRef, status: 'CONFIRMED', amountMinor: 500n, currencyCode: 'USD' },
    }),
  );
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef }));

  const result = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(result.outcome, 'ACK');

  const [rows] = await getPool().query(`SELECT status FROM billing_payment_attempts WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  assert.equal(rows[0].status, 'PENDING', 'an amount mismatch must never confirm the attempt');
  assert.equal(await lastAnomalyReasonFor(paymentAttemptId), 'AMOUNT_MISMATCH');
});

test('MySQL: a currency mismatch between queryPayment and the attempt\'s own snapshotted price is IGNORED and audited, never silently confirmed', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 1000n, 'USD');

  const service = buildWebhookService(
    fakeProvider(providerName, {
      verifyResult: { verified: true, providerEventId: randomUUID() },
      queryResult: { providerPaymentRef, status: 'CONFIRMED', amountMinor: 1000n, currencyCode: 'SAR' },
    }),
  );
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef }));

  const result = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(result.outcome, 'ACK');

  const [rows] = await getPool().query(`SELECT status FROM billing_payment_attempts WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  assert.equal(rows[0].status, 'PENDING', 'a currency mismatch must never confirm the attempt');
  assert.equal(await lastAnomalyReasonFor(paymentAttemptId), 'CURRENCY_MISMATCH');
});

test('MySQL: matching amount AND currency confirms the attempt exactly once, with a real PaymentTransaction row', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 2500n, 'SAR');

  const service = buildWebhookService(
    fakeProvider(providerName, {
      verifyResult: { verified: true, providerEventId: randomUUID() },
      queryResult: { providerPaymentRef, status: 'CONFIRMED', amountMinor: 2500n, currencyCode: 'SAR' },
    }),
  );
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef }));

  const result = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(result.outcome, 'ACK');

  const [rows] = await getPool().query(`SELECT status FROM billing_payment_attempts WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  assert.equal(rows[0].status, 'CONFIRMED');
  const [txRows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_transactions WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  assert.equal(Number(txRows[0].n), 1);
});

// --- PPR1R-D022: a transiently-FAILED event must stay re-drivable ---
//
// Before this fix, a transient failure (e.g. provider.queryPayment throwing
// on a network blip) was recorded FAILED and then ACKed 200. The provider's
// redelivery of that same event id hit the DUPLICATE idempotency path,
// which returned a stable ACK without ever re-running the business logic --
// so one blip permanently lost a payment confirmation and its entitlement
// activation. These tests pin all three halves of the corrected boundary:
// FAILED is re-drivable, IGNORED stays terminal, PROCESSED stays idempotent.

/**
 * A fake provider that counts queryPayment calls -- the call count is the
 * direct observable for "did the business logic actually re-run?", which a
 * row-count assertion alone cannot distinguish from "re-ran and was
 * idempotent".
 */
function countingProvider(providerName, providerEventId, queryPayment) {
  const state = { queryCalls: 0 };
  return {
    state,
    provider: {
      providerName,
      async createCheckout() {
        throw new Error('not used in this test file');
      },
      async verifyWebhook() {
        return { verified: true, providerEventId };
      },
      async queryPayment(ref) {
        state.queryCalls += 1;
        return queryPayment(state.queryCalls, ref);
      },
    },
  };
}

async function processingStatusOf(providerName, providerEventId) {
  const [rows] = await getPool().query(`SELECT processing_status FROM billing_provider_events WHERE provider = ? AND provider_event_id = ?`, [providerName, providerEventId]);
  return rows.length === 0 ? null : rows[0].processing_status;
}

async function attemptStatusOf(paymentAttemptId) {
  const [rows] = await getPool().query(`SELECT status FROM billing_payment_attempts WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  return rows[0].status;
}

async function transactionCountFor(paymentAttemptId) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_transactions WHERE payment_attempt_id = ?`, [paymentAttemptId]);
  return Number(rows[0].n);
}

test('MySQL: PPR1R-D022 -- a transiently-FAILED event is NOT ACKed, and the provider redelivery re-runs the business logic to success', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerEventId = randomUUID();
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 1500n, 'USD');

  const { state, provider } = countingProvider(providerName, providerEventId, (call) => {
    // The first delivery blips; every later one answers authoritatively.
    if (call === 1) throw new Error('simulated transient provider-query failure');
    return { providerPaymentRef, status: 'CONFIRMED', amountMinor: 1500n, currencyCode: 'USD' };
  });
  const service = buildWebhookService(provider);
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef }));

  const first = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(first.outcome, 'RETRY', 'a transient failure must never be ACKed -- an ACK makes it unrecoverable');
  assert.equal(first.httpStatus, 503);
  assert.equal(await processingStatusOf(providerName, providerEventId), 'FAILED');
  assert.equal(await attemptStatusOf(paymentAttemptId), 'PENDING', 'a failed provider query must never confirm anything');

  // The provider redelivers the SAME event id -- the exact case that used
  // to be swallowed by the DUPLICATE path.
  const second = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(second.outcome, 'ACK');
  assert.equal(second.httpStatus, 200);
  assert.equal(state.queryCalls, 2, 'the redelivery of a FAILED event MUST re-run the business logic');
  assert.equal(await attemptStatusOf(paymentAttemptId), 'CONFIRMED', 'the redelivery must recover the payment confirmation the blip lost');
  assert.equal(await transactionCountFor(paymentAttemptId), 1);
  assert.equal(await processingStatusOf(providerName, providerEventId), 'PROCESSED');

  // ...and once it has succeeded, further redeliveries are plain duplicates again.
  const third = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(third.outcome, 'ACK');
  assert.equal(third.httpStatus, 200);
  assert.equal(state.queryCalls, 2, 'a duplicate of a now-PROCESSED event must not re-run business logic');
  assert.equal(await transactionCountFor(paymentAttemptId), 1);
});

test('MySQL: PPR1R-D022 -- an IGNORED event stays terminal: redelivery is ACKed and never re-runs business logic', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerEventId = randomUUID();
  const unknownRef = `unknown-${randomUUID()}`;

  const { state, provider } = countingProvider(providerName, providerEventId, () => ({
    providerPaymentRef: unknownRef,
    status: 'CONFIRMED',
    amountMinor: 1000n,
    currencyCode: 'USD',
  }));
  const service = buildWebhookService(provider);
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef: unknownRef }));

  const first = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(first.outcome, 'ACK', 'an unknown reference is a terminal business anomaly, not a delivery failure');
  assert.equal(first.httpStatus, 200);
  assert.equal(await processingStatusOf(providerName, providerEventId), 'IGNORED');
  assert.equal(state.queryCalls, 1);

  const second = await service.processWebhook(providerName, payload, 'sig');
  assert.equal(second.outcome, 'ACK');
  assert.equal(second.httpStatus, 200);
  assert.equal(state.queryCalls, 1, 'an IGNORED event must stay terminal -- redelivery must NOT re-run business logic');
  assert.equal(await processingStatusOf(providerName, providerEventId), 'IGNORED');
});

test('MySQL: PPR1R-D022 -- a duplicate of a SUCCEEDED event stays fully idempotent (no re-query, no second transaction)', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerEventId = randomUUID();
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 3000n, 'SAR');

  const { state, provider } = countingProvider(providerName, providerEventId, () => ({
    providerPaymentRef,
    status: 'CONFIRMED',
    amountMinor: 3000n,
    currencyCode: 'SAR',
  }));
  const service = buildWebhookService(provider);
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef }));

  assert.equal((await service.processWebhook(providerName, payload, 'sig')).outcome, 'ACK');
  assert.equal(await processingStatusOf(providerName, providerEventId), 'PROCESSED');

  for (let i = 0; i < 3; i += 1) {
    const redelivery = await service.processWebhook(providerName, payload, 'sig');
    assert.equal(redelivery.outcome, 'ACK');
    assert.equal(redelivery.httpStatus, 200);
  }
  assert.equal(state.queryCalls, 1, 'a duplicate of a SUCCEEDED event must never re-enter the business logic');
  assert.equal(await transactionCountFor(paymentAttemptId), 1);
  assert.equal(await attemptStatusOf(paymentAttemptId), 'CONFIRMED');
});

test('MySQL: PPR1R-D022 -- concurrent redeliveries of a FAILED event re-drive it exactly once (atomic re-claim)', async () => {
  const providerName = `fake${randomBytes(6).toString('hex')}`;
  const providerEventId = randomUUID();
  const providerPaymentRef = `pay-${randomUUID()}`;
  const paymentAttemptId = await seedPendingAttempt(providerName, providerPaymentRef, 750n, 'USD');

  const { state, provider } = countingProvider(providerName, providerEventId, (call) => {
    if (call === 1) throw new Error('simulated transient provider-query failure');
    return { providerPaymentRef, status: 'CONFIRMED', amountMinor: 750n, currencyCode: 'USD' };
  });
  const service = buildWebhookService(provider);
  const payload = Buffer.from(JSON.stringify({ providerPaymentRef }));

  assert.equal((await service.processWebhook(providerName, payload, 'sig')).outcome, 'RETRY');
  assert.equal(await processingStatusOf(providerName, providerEventId), 'FAILED');

  const results = await Promise.all([
    service.processWebhook(providerName, payload, 'sig'),
    service.processWebhook(providerName, payload, 'sig'),
    service.processWebhook(providerName, payload, 'sig'),
    service.processWebhook(providerName, payload, 'sig'),
  ]);
  assert.ok(
    results.every((result) => result.outcome === 'ACK'),
    'once one concurrent redelivery has re-driven the event, every one of them is answered stably',
  );
  assert.equal(state.queryCalls, 2, 'exactly one of N concurrent redeliveries may win the re-claim');
  assert.equal(await transactionCountFor(paymentAttemptId), 1);
  assert.equal(await attemptStatusOf(paymentAttemptId), 'CONFIRMED');
  assert.equal(await processingStatusOf(providerName, providerEventId), 'PROCESSED');
});

test.after(async () => {
  await closePool();
});
