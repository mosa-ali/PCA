// PCA-BILL-2A -- TEST_SANDBOX PaymentProvider adapter: production gate,
// HMAC signature verification, and the in-memory checkout/query/refund
// lifecycle. Entirely in-process -- no DB, no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import {
  TestSandboxPaymentProvider,
  createSandboxPaymentProvider,
  SandboxProviderProductionGateError,
  SandboxPaymentNotFoundError,
} from '../../dist/billing/provider/sandboxProvider.js';
import { SandboxStaticSecretResolver, SANDBOX_ONLY_SECRET_REF } from '../../dist/billing/provider/secretResolver.js';

function resolver(secret = 'unit-test-secret') {
  return new SandboxStaticSecretResolver(secret);
}

test('createSandboxPaymentProvider refuses construction outside test/development', () => {
  assert.throws(() => createSandboxPaymentProvider(resolver(), { NODE_ENV: 'production' }), SandboxProviderProductionGateError);
  assert.throws(() => createSandboxPaymentProvider(resolver(), {}), SandboxProviderProductionGateError);
});

test('createSandboxPaymentProvider succeeds for test and development', () => {
  assert.ok(createSandboxPaymentProvider(resolver(), { NODE_ENV: 'test' }) instanceof TestSandboxPaymentProvider);
  assert.ok(createSandboxPaymentProvider(resolver(), { NODE_ENV: 'development' }) instanceof TestSandboxPaymentProvider);
});

test('createCheckout returns a JSON status-page redirectUrl, never a real payment page', async () => {
  const provider = new TestSandboxPaymentProvider(resolver());
  const result = await provider.createCheckout({
    amountMinor: 1000n,
    currencyCode: 'USD',
    accountRef: 'family-1',
    paymentAttemptId: 'attempt-1',
  });
  assert.match(result.redirectUrl, /^\/billing\/sandbox\/checkout\/sbx_chk_/);
  assert.equal(result.providerCheckoutRef.startsWith('sbx_chk_'), true);
});

test('verifyWebhook accepts a correctly-signed payload and returns the envelope eventId', async () => {
  const provider = new TestSandboxPaymentProvider(resolver());
  const { providerCheckoutRef } = await provider.createCheckout({
    amountMinor: 1000n,
    currencyCode: 'USD',
    accountRef: 'family-1',
    paymentAttemptId: 'attempt-1',
  });
  const rawPayload = provider.buildEnvelope(providerCheckoutRef, 'payment.confirmed');
  const signatureHeader = await provider.signPayload(rawPayload);
  const result = await provider.verifyWebhook({ rawPayload, signatureHeader });
  assert.equal(result.verified, true);
  assert.equal(typeof result.providerEventId, 'string');
  assert.equal(result.eventKind, 'payment.confirmed');
});

test('verifyWebhook rejects a payload signed with the wrong secret', async () => {
  const provider = new TestSandboxPaymentProvider(resolver('secret-a'));
  const rawPayload = provider.buildEnvelope('sbx_chk_x', 'payment.confirmed');
  const wrongSignature = createHmac('sha256', 'secret-b').update(rawPayload).digest('hex');
  const result = await provider.verifyWebhook({ rawPayload, signatureHeader: wrongSignature });
  assert.equal(result.verified, false);
});

test('verifyWebhook rejects a non-hex signature header rather than throwing', async () => {
  const provider = new TestSandboxPaymentProvider(resolver());
  const rawPayload = provider.buildEnvelope('sbx_chk_x', 'payment.confirmed');
  const result = await provider.verifyWebhook({ rawPayload, signatureHeader: 'not-hex-!!' });
  assert.equal(result.verified, false);
});

test('verifyWebhook rejects malformed JSON payload', async () => {
  const provider = new TestSandboxPaymentProvider(resolver());
  const rawPayload = Buffer.from('not json', 'utf8');
  const signatureHeader = await provider.signPayload(rawPayload);
  const result = await provider.verifyWebhook({ rawPayload, signatureHeader });
  assert.equal(result.verified, false);
});

test('queryPayment reflects simulateConfirm/simulateFail/simulateCancel state transitions', async () => {
  const provider = new TestSandboxPaymentProvider(resolver());
  const { providerCheckoutRef } = await provider.createCheckout({
    amountMinor: 500n,
    currencyCode: 'USD',
    accountRef: 'family-1',
    paymentAttemptId: 'attempt-1',
  });
  assert.equal((await provider.queryPayment(providerCheckoutRef)).status, 'PENDING');
  provider.simulateConfirm(providerCheckoutRef);
  assert.equal((await provider.queryPayment(providerCheckoutRef)).status, 'CONFIRMED');
  provider.simulateFail(providerCheckoutRef);
  assert.equal(provider.getStatusForTest(providerCheckoutRef), 'FAILED');
});

test('queryPayment throws SandboxPaymentNotFoundError for an unknown reference', async () => {
  const provider = new TestSandboxPaymentProvider(resolver());
  await assert.rejects(() => provider.queryPayment('does-not-exist'), SandboxPaymentNotFoundError);
});

test('refund on a CONFIRMED payment reports CONFIRMED; on a non-CONFIRMED payment reports FAILED', async () => {
  const provider = new TestSandboxPaymentProvider(resolver());
  const { providerCheckoutRef } = await provider.createCheckout({
    amountMinor: 500n,
    currencyCode: 'USD',
    accountRef: 'family-1',
    paymentAttemptId: 'attempt-1',
  });
  const unconfirmedRefund = await provider.refund(providerCheckoutRef, 500n, 'requested_by_customer');
  assert.equal(unconfirmedRefund.status, 'FAILED');

  provider.simulateConfirm(providerCheckoutRef);
  const confirmedRefund = await provider.refund(providerCheckoutRef, 500n, 'requested_by_customer');
  assert.equal(confirmedRefund.status, 'CONFIRMED');
});

test('SandboxStaticSecretResolver resolves only its own secretRef and rejects any other', async () => {
  const r = resolver('abc');
  assert.equal(await r.resolve(SANDBOX_ONLY_SECRET_REF), 'abc');
  await assert.rejects(() => r.resolve('SOME_OTHER_REF'));
});
