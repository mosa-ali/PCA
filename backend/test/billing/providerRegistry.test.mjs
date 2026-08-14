// PCA-BILL-2A -- providerRegistry.ts: fail-closed resolution + the
// production gate on createDefaultProviderRegistry. No DB, no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PaymentProviderRegistry,
  UnknownProviderError,
  DuplicateProviderRegistrationError,
  createDefaultProviderRegistry,
} from '../../dist/billing/provider/providerRegistry.js';

function fakeProvider(name) {
  return { providerName: name };
}

test('resolve() throws UnknownProviderError for anything not explicitly registered', () => {
  const registry = new PaymentProviderRegistry();
  assert.throws(() => registry.resolve('NOPE'), UnknownProviderError);
});

test('register() + resolve() round-trips a provider by name', () => {
  const registry = new PaymentProviderRegistry();
  const provider = fakeProvider('FAKE');
  registry.register(provider);
  assert.equal(registry.resolve('FAKE'), provider);
  assert.equal(registry.isRegistered('FAKE'), true);
  assert.deepEqual(registry.listRegisteredProviderNames(), ['FAKE']);
});

test('register() rejects a duplicate provider name', () => {
  const registry = new PaymentProviderRegistry();
  registry.register(fakeProvider('FAKE'));
  assert.throws(() => registry.register(fakeProvider('FAKE')), DuplicateProviderRegistrationError);
});

test('createDefaultProviderRegistry registers TEST_SANDBOX when NODE_ENV=test', () => {
  const registry = createDefaultProviderRegistry({ env: { ...process.env, NODE_ENV: 'test' } });
  assert.equal(registry.isRegistered('TEST_SANDBOX'), true);
});

test('createDefaultProviderRegistry registers TEST_SANDBOX when NODE_ENV=development', () => {
  const registry = createDefaultProviderRegistry({ env: { ...process.env, NODE_ENV: 'development' } });
  assert.equal(registry.isRegistered('TEST_SANDBOX'), true);
});

test('createDefaultProviderRegistry returns an EMPTY registry in production -- fails closed, no silent sandbox/default provider', () => {
  const registry = createDefaultProviderRegistry({ env: { ...process.env, NODE_ENV: 'production' } });
  assert.deepEqual(registry.listRegisteredProviderNames(), []);
  assert.throws(() => registry.resolve('TEST_SANDBOX'), UnknownProviderError);
});

test('createDefaultProviderRegistry returns an EMPTY registry when NODE_ENV is unset', () => {
  const env = { ...process.env };
  delete env.NODE_ENV;
  const registry = createDefaultProviderRegistry({ env });
  assert.deepEqual(registry.listRegisteredProviderNames(), []);
});
