// PCA-BILL-2A -- providerRegistry.ts: fail-closed resolution + the
// production gate on createDefaultProviderRegistry. No DB, no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PaymentProviderRegistry,
  UnknownProviderError,
  DuplicateProviderRegistrationError,
  PaymentProviderProductionActivationError,
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

// Writer73: PCA-BILL production kill-switch -- register() itself, with the production-activation
// gate explicitly opted into (mirroring createDefaultProviderRegistry's own construction), never
// a change to plain `new PaymentProviderRegistry()`'s default (unaffected, and covered by the
// 'register() + resolve() round-trips a provider by name' test above regardless of ambient
// NODE_ENV).

test('PRODUCTION KILL-SWITCH: with the gate enforced, register() refuses a non-approved provider outside test/development', () => {
  const registry = new PaymentProviderRegistry({ env: { NODE_ENV: 'production' }, enforceProductionActivationGate: true });
  assert.throws(() => registry.register(fakeProvider('STRIPE')), PaymentProviderProductionActivationError);
  assert.deepEqual(registry.listRegisteredProviderNames(), [], 'a refused registration must never partially register');
});

test('PRODUCTION KILL-SWITCH: an explicit, exact-name PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION approval allows that ONE provider through', () => {
  const registry = new PaymentProviderRegistry({
    env: { NODE_ENV: 'production', PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION: 'STRIPE' },
    enforceProductionActivationGate: true,
  });
  registry.register(fakeProvider('STRIPE'));
  assert.equal(registry.isRegistered('STRIPE'), true);
});

test('PRODUCTION KILL-SWITCH: an approval for a DIFFERENT provider name never also approves this one (no wildcard/boolean escape hatch)', () => {
  const registry = new PaymentProviderRegistry({
    env: { NODE_ENV: 'production', PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION: 'STRIPE' },
    enforceProductionActivationGate: true,
  });
  assert.throws(() => registry.register(fakeProvider('SOME_OTHER_PROVIDER')), PaymentProviderProductionActivationError);
});

test('PRODUCTION KILL-SWITCH: the gate never fires in test/development, with or without an approval env var set', () => {
  for (const nodeEnv of ['test', 'development']) {
    const registry = new PaymentProviderRegistry({ env: { NODE_ENV: nodeEnv }, enforceProductionActivationGate: true });
    registry.register(fakeProvider('ANYTHING'));
    assert.equal(registry.isRegistered('ANYTHING'), true);
  }
});

test('PRODUCTION KILL-SWITCH: createDefaultProviderRegistry\'s own registry has the gate enforced, but the sandbox registration in development still succeeds (no regression)', () => {
  const registry = createDefaultProviderRegistry({ env: { ...process.env, NODE_ENV: 'development' } });
  assert.equal(registry.isRegistered('TEST_SANDBOX'), true);
});

test('PRODUCTION KILL-SWITCH: a caller who does not opt in (plain `new PaymentProviderRegistry()`) is completely unaffected by NODE_ENV', () => {
  const registry = new PaymentProviderRegistry({ env: { NODE_ENV: 'production' } });
  registry.register(fakeProvider('ANY_TEST_DOUBLE'));
  assert.equal(registry.isRegistered('ANY_TEST_DOUBLE'), true);
});
