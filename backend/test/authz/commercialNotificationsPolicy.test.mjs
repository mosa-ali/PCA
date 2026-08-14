// PCA-COMMERCIAL-NOTIFY-1: the two additive ServiceOperation members
// (VIEW_OWN_NOTIFICATIONS/ACKNOWLEDGE_OWN_NOTIFICATION) resolve to the
// expected family-scope-required, no-license-required requirements, and
// every pre-existing operation's requirements are unchanged.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequirements } from '../../dist/authz/policy.js';

test('VIEW_OWN_NOTIFICATIONS requires family scope, not a license', () => {
  assert.deepEqual(resolveRequirements('VIEW_OWN_NOTIFICATIONS'), { requiresFamilyScope: true, requiresLicense: false });
});

test('ACKNOWLEDGE_OWN_NOTIFICATION requires family scope, not a license', () => {
  assert.deepEqual(resolveRequirements('ACKNOWLEDGE_OWN_NOTIFICATION'), { requiresFamilyScope: true, requiresLicense: false });
});

test('pre-existing operations are unaffected by the additive entries', () => {
  assert.deepEqual(resolveRequirements('VIEW_OWN_BILLING_STATUS'), { requiresFamilyScope: true, requiresLicense: false });
  assert.deepEqual(resolveRequirements('INITIATE_CHECKOUT'), { requiresFamilyScope: true, requiresLicense: true });
  assert.deepEqual(resolveRequirements('LICENSE_LOOKUP'), { requiresFamilyScope: false, requiresLicense: false });
});

test('an unregistered operation still throws (closed matrix, no default row)', () => {
  assert.throws(() => resolveRequirements('NOT_A_REAL_OPERATION'), /No authorization requirements registered/);
});
