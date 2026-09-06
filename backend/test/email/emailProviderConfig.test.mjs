import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailProviderConfigError, resolveEmailProviderAdapter } from '../../dist/email/emailProviderConfig.js';
import { SmtpEmailProviderAdapter } from '../../dist/email/providers/SmtpEmailProviderAdapter.js';
import { MicrosoftGraphEmailProviderAdapter } from '../../dist/email/providers/MicrosoftGraphEmailProviderAdapter.js';
import { RejectingEmailProviderAdapter } from '../../dist/email/providers/RejectingEmailProviderAdapter.js';

const SMTP_ENV = {
  NODE_ENV: 'production',
  PCA_EMAIL_PROVIDER: 'SMTP',
  PCA_EMAIL_FROM_ADDRESS: 'no-reply@pcasafe.com',
  PCA_SMTP_HOST: 'smtp.example.com',
  PCA_SMTP_PORT: '587',
  PCA_SMTP_SECURE: 'false',
  PCA_SMTP_USERNAME: 'user',
  PCA_SMTP_PASSWORD: 'pass',
};

const GRAPH_ENV = {
  NODE_ENV: 'production',
  PCA_EMAIL_PROVIDER: 'MICROSOFT_GRAPH',
  PCA_EMAIL_FROM_ADDRESS: 'no-reply@pcasafe.com',
  PCA_GRAPH_TENANT_ID: 'tenant-id',
  PCA_GRAPH_CLIENT_ID: 'client-id',
  PCA_GRAPH_CLIENT_SECRET: 'client-secret',
  PCA_GRAPH_SENDER_USER_ID: 'no-reply@pcasafe.com',
};

test('resolves a real SmtpEmailProviderAdapter when PCA_EMAIL_PROVIDER=SMTP and config is complete', () => {
  assert.ok(resolveEmailProviderAdapter(SMTP_ENV) instanceof SmtpEmailProviderAdapter);
});

test('resolves a real MicrosoftGraphEmailProviderAdapter when PCA_EMAIL_PROVIDER=MICROSOFT_GRAPH and config is complete', () => {
  assert.ok(resolveEmailProviderAdapter(GRAPH_ENV) instanceof MicrosoftGraphEmailProviderAdapter);
});

test('SECURITY: FAILS CLOSED (throws) in production when PCA_EMAIL_PROVIDER is unset/unrecognized', () => {
  assert.throws(() => resolveEmailProviderAdapter({ NODE_ENV: 'production' }), EmailProviderConfigError);
  assert.throws(() => resolveEmailProviderAdapter({}), EmailProviderConfigError, 'unset NODE_ENV must fail closed too');
  assert.throws(() => resolveEmailProviderAdapter({ NODE_ENV: 'production', PCA_EMAIL_PROVIDER: 'smtp' }), EmailProviderConfigError, 'case-sensitive: lowercase must not match');
});

test('returns RejectingEmailProviderAdapter (never throws) in test/development when unconfigured', () => {
  assert.ok(resolveEmailProviderAdapter({ NODE_ENV: 'test' }) instanceof RejectingEmailProviderAdapter);
  assert.ok(resolveEmailProviderAdapter({ NODE_ENV: 'development' }) instanceof RejectingEmailProviderAdapter);
});

test('throws EmailProviderConfigError when PCA_EMAIL_PROVIDER=SMTP but a required field is missing', () => {
  const { PCA_SMTP_HOST, ...incomplete } = SMTP_ENV;
  assert.throws(() => resolveEmailProviderAdapter(incomplete), EmailProviderConfigError);
});

test('throws EmailProviderConfigError for an invalid PCA_SMTP_PORT', () => {
  assert.throws(() => resolveEmailProviderAdapter({ ...SMTP_ENV, PCA_SMTP_PORT: 'not-a-port' }), EmailProviderConfigError);
  assert.throws(() => resolveEmailProviderAdapter({ ...SMTP_ENV, PCA_SMTP_PORT: '99999' }), EmailProviderConfigError);
});

test('throws EmailProviderConfigError when PCA_EMAIL_PROVIDER=MICROSOFT_GRAPH but a required field is missing', () => {
  const { PCA_GRAPH_CLIENT_SECRET, ...incomplete } = GRAPH_ENV;
  assert.throws(() => resolveEmailProviderAdapter(incomplete), EmailProviderConfigError);
});

test('PCA_EMAIL_FROM_NAME defaults to "PCA" and PCA_EMAIL_REPLY_TO_ADDRESS is optional -- both providers construct fine without them', () => {
  assert.doesNotThrow(() => resolveEmailProviderAdapter(SMTP_ENV));
  assert.doesNotThrow(() => resolveEmailProviderAdapter(GRAPH_ENV));
});
