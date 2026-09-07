import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertProductionEmailConfigurationComplete,
  resolveEmailProviderAdapter,
} from '../../dist/email/emailProviderConfig.js';
import {
  MissingEmailOutboxEncryptionKeyError,
  InvalidEmailOutboxEncryptionKeyError,
} from '../../dist/email/emailOutboxEncryption.js';

/**
 * PCA-DW-E2E: the production email path must fail at BOOT on an incomplete
 * outbox configuration, not at the first real parent registration.
 *
 * Observed before this guard existed, against a real backend on a real
 * migrated MySQL 8.4 database (NODE_ENV=production, SMTP fully configured,
 * PCA_EMAIL_OUTBOX_ENCRYPTION_KEY absent):
 *
 *   /health        -> {"service":"pca-backend","status":"ok"}
 *   /health/email  -> {"status":"ok","provider":"SMTP"}
 *   POST /api/parent/register -> HTTP 500 {"error":"internal_error"}
 *                     ... and the parent_accounts row was created anyway,
 *                     with ZERO email_outbox rows -- the throw happens
 *                     before the outbox insert, so even the durable retry
 *                     path never saw the message.
 *
 * Both health signals an operator checks before a production cutover reported
 * green over a completely non-functional authentication path. These tests pin
 * that the misconfiguration is now refused up front, and — just as important —
 * that the deliberate not-yet-configured state still boots.
 */

const SMTP_ENV = Object.freeze({
  NODE_ENV: 'production',
  PCA_EMAIL_PROVIDER: 'SMTP',
  PCA_EMAIL_FROM_ADDRESS: 'noreply@example.invalid',
  PCA_EMAIL_FROM_NAME: 'PCA',
  PCA_SMTP_HOST: 'smtp.example.invalid',
  PCA_SMTP_PORT: '587',
  PCA_SMTP_SECURE: 'false',
  PCA_SMTP_USERNAME: 'user',
  PCA_SMTP_PASSWORD: 'pass',
});

/** 32 zero bytes, base64 -- a structurally valid key, never a real one. */
const VALID_KEY = Buffer.alloc(32).toString('base64');

test('a selected provider with NO outbox encryption key is refused at startup', () => {
  assert.throws(
    () => assertProductionEmailConfigurationComplete({ ...SMTP_ENV }),
    MissingEmailOutboxEncryptionKeyError,
    'a production deployment missing only the outbox key must refuse to start, not 500 on the first registration',
  );
});

test('a selected provider with a MALFORMED outbox encryption key is refused at startup', () => {
  assert.throws(
    () => assertProductionEmailConfigurationComplete({ ...SMTP_ENV, PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: 'not-base64!!' }),
    InvalidEmailOutboxEncryptionKeyError,
  );
});

test('a selected provider with a WRONG-LENGTH outbox encryption key is refused at startup', () => {
  assert.throws(
    () =>
      assertProductionEmailConfigurationComplete({
        ...SMTP_ENV,
        PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
      }),
    InvalidEmailOutboxEncryptionKeyError,
  );
});

test('a fully configured production email path starts', () => {
  assert.doesNotThrow(() =>
    assertProductionEmailConfigurationComplete({ ...SMTP_ENV, PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: VALID_KEY }),
  );
});

test('Microsoft Graph is held to the same outbox-key requirement as SMTP', () => {
  const graphEnv = {
    NODE_ENV: 'production',
    PCA_EMAIL_PROVIDER: 'MICROSOFT_GRAPH',
    PCA_EMAIL_FROM_ADDRESS: 'noreply@example.invalid',
    PCA_GRAPH_TENANT_ID: 't',
    PCA_GRAPH_CLIENT_ID: 'c',
    PCA_GRAPH_CLIENT_SECRET: 's',
    PCA_GRAPH_SENDER_USER_ID: 'u',
  };
  assert.throws(() => assertProductionEmailConfigurationComplete(graphEnv), MissingEmailOutboxEncryptionKeyError);
  assert.doesNotThrow(() =>
    assertProductionEmailConfigurationComplete({ ...graphEnv, PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: VALID_KEY }),
  );
});

test('NEGATIVE CONTROL: with NO provider selected, a missing outbox key still boots', () => {
  // This is the deliberate not-yet-configured state. Turning it into a crash
  // would break every environment that has not chosen an email provider yet,
  // which is the whole product today -- the guard must not overreach.
  assert.doesNotThrow(() => assertProductionEmailConfigurationComplete({ NODE_ENV: 'production' }));
  assert.doesNotThrow(() =>
    assertProductionEmailConfigurationComplete({ NODE_ENV: 'production', PCA_EMAIL_PROVIDER: '' }),
  );
});

test('NEGATIVE CONTROL: the pre-existing incomplete-credentials boot failure is unchanged', () => {
  // The guard must be additive. A named provider with missing credentials was
  // already refused at startup, and still must be.
  assert.throws(
    () =>
      resolveEmailProviderAdapter({
        NODE_ENV: 'production',
        PCA_EMAIL_PROVIDER: 'SMTP',
        PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: VALID_KEY,
      }),
    /PCA_EMAIL_FROM_ADDRESS is required/,
  );
});
