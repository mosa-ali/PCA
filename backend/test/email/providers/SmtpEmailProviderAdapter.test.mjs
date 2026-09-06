import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { SmtpEmailProviderAdapter, classifySmtpErrorCategory, isSmtpErrorRetryable } from '../../../dist/email/providers/SmtpEmailProviderAdapter.js';
import { EmailDeliveryError } from '../../../dist/email/EmailProviderAdapter.js';
import { EMAIL_PROVIDER_TIMEOUT_MS } from '../../../dist/email/emailTimingPolicy.js';

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

test('classifySmtpErrorCategory: maps every recognized shape to a safe category, never echoing raw provider text', () => {
  assert.equal(classifySmtpErrorCategory({ code: 'ETIMEDOUT' }), 'EMAIL_PROVIDER_TIMEOUT');
  assert.equal(classifySmtpErrorCategory({ code: 'ESOCKETTIMEDOUT' }), 'EMAIL_PROVIDER_TIMEOUT');
  assert.equal(classifySmtpErrorCategory({ code: 'EAUTH' }), 'EMAIL_PROVIDER_AUTH_FAILED');
  assert.equal(classifySmtpErrorCategory({ code: 'ECONNECTION' }), 'EMAIL_PROVIDER_NETWORK');
  assert.equal(classifySmtpErrorCategory({ responseCode: 450 }), 'EMAIL_PROVIDER_RATE_LIMITED');
  assert.equal(classifySmtpErrorCategory({ responseCode: 550 }), 'EMAIL_PROVIDER_REJECTED');
  assert.equal(classifySmtpErrorCategory({ code: 'EENVELOPE' }), 'EMAIL_PROVIDER_REJECTED');
  assert.equal(classifySmtpErrorCategory({}), 'EMAIL_PROVIDER_UNKNOWN');
});

test('a genuine connection failure (nothing listening on the target port) throws a retryable, categorized EmailDeliveryError', async () => {
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
      assert.equal(typeof error.category, 'string');
      assert.ok(error.category.startsWith('EMAIL_PROVIDER_'));
      return true;
    },
  );
});

// PCA-DW-W2-R1-7: encrypted transport must be mandatory, never opportunistic.
test('SECURITY: when secure=false (STARTTLS path), the transporter is configured with requireTLS=true -- STARTTLS is mandatory, never opportunistic plaintext fallback', () => {
  const adapter = new SmtpEmailProviderAdapter({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    fromAddress: 'no-reply@pcasafe.com',
    fromName: 'PCA',
  });
  assert.equal(adapter.transporter.options.requireTLS, true);
});

test('SECURITY: when secure=true (implicit TLS), the connection is already encrypted from the start regardless of requireTLS', () => {
  const adapter = new SmtpEmailProviderAdapter({
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    fromAddress: 'no-reply@pcasafe.com',
    fromName: 'PCA',
  });
  assert.equal(adapter.transporter.options.secure, true);
});

test('SECURITY: TLS certificate verification is never disabled', () => {
  const adapter = new SmtpEmailProviderAdapter({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    fromAddress: 'no-reply@pcasafe.com',
    fromName: 'PCA',
  });
  assert.equal(adapter.transporter.options.tls.rejectUnauthorized, true);
});

// PCA-DW-W2-R1-6: every SMTP network phase must be bounded well under the
// outbox claim lease -- never left to the bare OS TCP default.
test('every SMTP timeout phase (connect/greeting/socket) is bounded by EMAIL_PROVIDER_TIMEOUT_MS', () => {
  const adapter = new SmtpEmailProviderAdapter({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    fromAddress: 'no-reply@pcasafe.com',
    fromName: 'PCA',
  });
  assert.equal(adapter.transporter.options.connectionTimeout, EMAIL_PROVIDER_TIMEOUT_MS);
  assert.equal(adapter.transporter.options.greetingTimeout, EMAIL_PROVIDER_TIMEOUT_MS);
  assert.equal(adapter.transporter.options.socketTimeout, EMAIL_PROVIDER_TIMEOUT_MS);
});
