// PCA-DW-W2-15D -- the single runtime-environment authority. Every
// production-sensitivity check in this codebase (Secure cookies, the
// __Host- cookie prefix, trustProxy configuration, verification-code HMAC
// secret enforcement) must agree on the same answer for the same NODE_ENV,
// and that answer must be FAIL CLOSED: anything other than the exact
// strings "test" or "development" is production-sensitive.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKnownRuntimeEnvironment,
  isProductionSensitiveRuntime,
  UnknownRuntimeEnvironmentError,
} from '../../dist/runtime/environment.js';

test('isProductionSensitiveRuntime is false for exactly "test" and "development"', () => {
  assert.equal(isProductionSensitiveRuntime({ NODE_ENV: 'test' }), false);
  assert.equal(isProductionSensitiveRuntime({ NODE_ENV: 'development' }), false);
});

test('isProductionSensitiveRuntime is true for "production"', () => {
  assert.equal(isProductionSensitiveRuntime({ NODE_ENV: 'production' }), true);
});

test('SECURITY: isProductionSensitiveRuntime FAILS CLOSED for missing/unrecognized NODE_ENV -- never fails open', () => {
  assert.equal(isProductionSensitiveRuntime({}), true, 'unset NODE_ENV must be treated as production-sensitive');
  assert.equal(isProductionSensitiveRuntime({ NODE_ENV: '' }), true, 'empty string must be treated as production-sensitive');
  assert.equal(isProductionSensitiveRuntime({ NODE_ENV: 'Production' }), true, 'wrong case must not be treated as a safe value');
  assert.equal(isProductionSensitiveRuntime({ NODE_ENV: 'staging' }), true, 'an environment this codebase does not recognize must be treated as production-sensitive');
  assert.equal(isProductionSensitiveRuntime({ NODE_ENV: 'developmentt' }), true, 'a near-miss typo of a safe value must not be treated as safe');
});

test('isProductionSensitiveRuntime never throws, even for garbage input', () => {
  assert.doesNotThrow(() => isProductionSensitiveRuntime({}));
  assert.doesNotThrow(() => isProductionSensitiveRuntime({ NODE_ENV: undefined }));
});

test('assertKnownRuntimeEnvironment accepts exactly the three known values and returns them', () => {
  assert.equal(assertKnownRuntimeEnvironment({ NODE_ENV: 'test' }), 'test');
  assert.equal(assertKnownRuntimeEnvironment({ NODE_ENV: 'development' }), 'development');
  assert.equal(assertKnownRuntimeEnvironment({ NODE_ENV: 'production' }), 'production');
});

test('assertKnownRuntimeEnvironment throws UnknownRuntimeEnvironmentError for anything else', () => {
  assert.throws(() => assertKnownRuntimeEnvironment({}), UnknownRuntimeEnvironmentError);
  assert.throws(() => assertKnownRuntimeEnvironment({ NODE_ENV: '' }), UnknownRuntimeEnvironmentError);
  assert.throws(() => assertKnownRuntimeEnvironment({ NODE_ENV: 'staging' }), UnknownRuntimeEnvironmentError);
});
