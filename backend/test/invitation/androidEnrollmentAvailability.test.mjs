import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAndroidEnrollmentReady } from '../../dist/invitation/androidEnrollmentAvailability.js';

test('production Android enrollment defaults closed until explicitly enabled', () => {
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'production' }), false);
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'production', PCA_CHILD_APP_ENROLLMENT_READY: 'true' }), true);
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'production', PCA_CHILD_APP_ENROLLMENT_READY: 'TRUE' }), false);
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'production', PCA_CHILD_APP_ENROLLMENT_READY: 'yes' }), false);
});

test('development and test retain local enrollment when the owner has not explicitly disabled it', () => {
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'development' }), true);
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'test' }), true);
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'development', PCA_CHILD_APP_ENROLLMENT_READY: 'false' }), false);
});

test('unknown runtime values fail closed', () => {
  assert.equal(resolveAndroidEnrollmentReady({ NODE_ENV: 'staging' }), false);
  assert.equal(resolveAndroidEnrollmentReady({}), false);
});
