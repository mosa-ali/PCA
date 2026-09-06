import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { SmtpEmailProviderAdapter, isSmtpErrorRetryable } from '../../../dist/email/providers/SmtpEmailProviderAdapter.js';
import { EmailDeliveryError } from '../../../dist/email/EmailProviderAdapter.js';

test('isSmtpErrorRetryable: SMTP 5xx responses and EAUTH/EENVELOPE are permanent (not retryable)', () => {
  assert.equal(isSmtpErrorRetryable({ responseCode: 550 }), false);
  assert.equal(isSmtpErrorRetryable({ responseCode: 553 }), false);
  assert.equal(isSmtpErrorRetryable({ code: 'EAUTH' }), false);
  assert.equal(isSmtpErrorRetryable({ code: 'EENVELOPE' }), false);
});

test('isSmtpErrorRetryable: connection/timeout errors and 4xx are retryable, and an unrecognized shape defaults to retryable', () => {
  assert.equal(isSmtpErrorRetryable({ responseCode: 421 }), true);
  assert.equal(isSmtpErrorRetryable({ code: 'ECONNECTION' }), true);
  assert.equal(isSmtpErrorRetryable({ code: 'ETIMEDOUT' }), true);
  assert.equal(isSmtpErrorRetryable({}), true);
});

test('a genuine connection failure (nothing listening on the target port) throws a retryable EmailDeliveryError', async () => {
  // Bind an ephemeral port, then close it immediately -- guarantees nothing
  // is listening there, a real (not simulated) connection-refused.
  const probe = createServer();
  const port = await new Promise((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve(probe.address().port));
  });
  await new Promise((resolve) => probe.close(resolve));

  const adapter = new SmtpEmailProviderAdapter({
    host: '127.0.0.1',
    port,
    secure: false,
    fromAddress: 'no-reply@pcasafe.com',
    fromName: 'PCA',
  });

  await assert.rejects(
    () => adapter.send({ toEmail: 'someone@example.com', subject: 'Test', text: 'body', html: '<p>body</p>' }),
    (error) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});
