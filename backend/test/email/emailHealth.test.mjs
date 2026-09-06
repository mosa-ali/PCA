import assert from 'node:assert/strict';
import test from 'node:test';
import { getEmailServiceHealth } from '../../dist/email/emailHealth.js';
import { RejectingEmailProviderAdapter } from '../../dist/email/providers/RejectingEmailProviderAdapter.js';

test('reports providerConfigured=false for RejectingEmailProviderAdapter', () => {
  const health = getEmailServiceHealth(new RejectingEmailProviderAdapter());
  assert.deepEqual(health, { providerConfigured: false, providerName: 'REJECTING_NO_PROVIDER_CONFIGURED' });
});

test('reports providerConfigured=true for any other named provider', () => {
  assert.deepEqual(getEmailServiceHealth({ providerName: 'SMTP' }), { providerConfigured: true, providerName: 'SMTP' });
  assert.deepEqual(getEmailServiceHealth({ providerName: 'MICROSOFT_GRAPH' }), { providerConfigured: true, providerName: 'MICROSOFT_GRAPH' });
});
