import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONFIGURABLE_POLICY_OPERATIONS,
  deriveDeliveryStatus,
  isRequestOnly,
  isRoleChangeTargetAllowed,
  requiresStepUp,
  resolveOperationAuthorization,
} from '../../dist/familyrbac/policy.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';

const CONFIGURED = { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: true };

test('doc 18 table row: VIEW_DASHBOARD', () => {
  assert.equal(resolveOperationAuthorization('OWNER', 'VIEW_DASHBOARD', defaultFamilyRbacPolicyConfig()), 'ALLOW');
  assert.equal(resolveOperationAuthorization('ADMINISTRATOR', 'VIEW_DASHBOARD', defaultFamilyRbacPolicyConfig()), 'ALLOW');
  assert.equal(resolveOperationAuthorization('VIEWER', 'VIEW_DASHBOARD', defaultFamilyRbacPolicyConfig()), 'ALLOW_READ_ONLY');
  assert.equal(resolveOperationAuthorization('CHILD', 'VIEW_DASHBOARD', defaultFamilyRbacPolicyConfig()), 'ALLOW_OWN_SCOPE_ONLY');
});

test('doc 18 table row: EDIT_CHILD_POLICY / approvals -- Owner+Admin allow, Viewer deny, Child request-only', () => {
  for (const op of ['EDIT_CHILD_POLICY', 'APPROVE_BONUS_TIME', 'APPROVE_UNBLOCK', 'APPROVE_EXCEPTION', 'APPROVE_INSTALL']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, defaultFamilyRbacPolicyConfig()), 'ALLOW');
    assert.equal(resolveOperationAuthorization('VIEWER', op, defaultFamilyRbacPolicyConfig()), 'DENY');
    assert.equal(resolveOperationAuthorization('CHILD', op, defaultFamilyRbacPolicyConfig()), 'REQUEST_ONLY');
  }
});

// CORRECTION OF A TEST THAT PINNED AN UNRATIFIED DEFAULT AS THE SPECIFICATION.
//
// The preceding version of this test was named "... are normal Administrator
// administration with step-up" and asserted ALLOW_WITH_STEP_UP for ADMINISTRATOR
// while passing `defaultFamilyRbacPolicyConfig()` -- the config whose documented
// meaning is "the Owner has NOT granted this". doc 18 Section 2 does not give
// these cells a flat allow: its table says "configurable policy + step-up" /
// "configurable + step-up", and its prose says "An Owner may choose whether an
// Administrator can add/remove a Viewer or revoke a child device; the SAFE
// DEFAULT IS OFF."
//
// So the old test asserted, as the specification, the exact behaviour that the
// specification forbids: an Administrator permitted to add a Viewer under a
// config that grants nothing. A green test was providing assurance about a
// security-sensitive authorization decision that the document contradicts.
//
// The assertions are KEPT rather than deleted -- deleting them would hide the
// real behaviour instead of recording it -- but they are re-framed for what they
// are: a RECORD OF A DISCREPANCY between doc 18 Section 2 and the code, pending
// PCA-DEC-034. This test does NOT endorse the behaviour and must not be cited as
// evidence that it is correct.
test('PCA-DEC-034 DISCREPANCY RECORD: ADD_VIEWER / REMOVE_NON_OWNER_PARENT are allowed to ADMINISTRATOR even under the default (never-granted) config', () => {
  const neverGranted = defaultFamilyRbacPolicyConfig();
  assert.deepEqual(neverGranted, { administratorCanManageViewers: false, administratorCanRevokeDeviceOrDisableProtection: false }, 'the default config is the documented "safe default is off"');
  for (const op of ['ADD_VIEWER', 'REMOVE_NON_OWNER_PARENT']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, neverGranted), 'ALLOW');
    // doc 18 Section 2 cell: ADMINISTRATOR "configurable policy + step-up"; prose: "safe default is off".
    // Actual: allowed. Recorded, not endorsed -- see PCA-DEC-034.
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, neverGranted), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('VIEWER', op, CONFIGURED), 'DENY');
    assert.equal(resolveOperationAuthorization('CHILD', op, CONFIGURED), 'DENY');
  }
});

test('PCA-DEC-034 DISCREPANCY RECORD: the configurable verdict is never used as a matrix cell, and the resolver is insensitive to config', () => {
  // Two facts, both asserted rather than asserted-in-a-comment, because together
  // they are the whole reason the four configurable operations above behave as
  // they do. This is the PROOF of the discard: not "the config has no writer"
  // (that is a call-graph fact) but "the config cannot change a verdict at all"
  // (a behavioural fact, proven by feeding the extremes).
  //
  // This test will FAIL the moment the configurable layer is implemented. That is
  // deliberate and it is the point: implementing it is a documented FEATURE with
  // a security requirement attached (doc 18 Section 2: policy configuration is
  // "itself E2EE, signed, and auditable"), so it must not land as a silent
  // refactor. If this fails, update PCA-DEC-034 and the production-path register
  // in the same change, and replace this test with one that asserts the
  // configured semantics.
  const maximallyPermissive = { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: true };
  const maximallyRestrictive = { administratorCanManageViewers: false, administratorCanRevokeDeviceOrDisableProtection: false };
  const ROLES = ['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'];
  const OPERATIONS = [
    'VIEW_DASHBOARD', 'EDIT_CHILD_POLICY', 'APPROVE_BONUS_TIME', 'APPROVE_UNBLOCK', 'APPROVE_EXCEPTION',
    'APPROVE_INSTALL', 'ADD_VIEWER', 'REMOVE_NON_OWNER_PARENT', 'ADD_ADMINISTRATOR', 'CHANGE_ROLE',
    'CHANGE_RETENTION', 'DELETE_NOW', 'EXPORT_FAMILY_DATA', 'REMOVE_REVOKE_DEVICE', 'DISABLE_PROTECTION_POLICY',
    'OWNERSHIP_TRANSFER_INITIATION', 'RECOVERY_SENSITIVE_ACTION',
  ];
  let comparisons = 0;
  for (const operation of OPERATIONS) {
    for (const role of ROLES) {
      assert.equal(
        resolveOperationAuthorization(role, operation, maximallyPermissive),
        resolveOperationAuthorization(role, operation, maximallyRestrictive),
        `${role}/${operation} responds to FamilyRbacPolicyConfig, which means the configurable layer has been wired -- update PCA-DEC-034 and the register, do not just adjust this test`,
      );
      comparisons += 1;
    }
  }
  assert.equal(comparisons, 68, 'every role/operation pair must actually be compared -- a loop that compared nothing would pass vacuously');

  // And the configurable verdict is still absent from the matrix: if a cell were
  // added with it, the cells above would collapse to DENY and this record would
  // be stale.
  for (const operation of OPERATIONS) {
    for (const role of ROLES) {
      assert.notEqual(
        resolveOperationAuthorization(role, operation, maximallyPermissive),
        undefined,
        `${role}/${operation} resolved to undefined`,
      );
    }
  }
});

test('PCA-DEC-034 DISCREPANCY RECORD: the four operations doc 18 Section 2 marks configurable are exactly those the register tracks', () => {
  // Keeps the code-side enumeration (CONFIGURABLE_POLICY_OPERATIONS) and the doc
  // reading in agreement, so the set cannot silently shrink or grow.
  assert.deepEqual(
    [...CONFIGURABLE_POLICY_OPERATIONS].sort(),
    ['ADD_VIEWER', 'DISABLE_PROTECTION_POLICY', 'REMOVE_NON_OWNER_PARENT', 'REMOVE_REVOKE_DEVICE'],
    'the operations doc 18 Section 2 marks "configurable" changed -- confirm against the doc table before adjusting this list',
  );
  for (const operation of CONFIGURABLE_POLICY_OPERATIONS) {
    assert.equal(
      resolveOperationAuthorization('ADMINISTRATOR', operation, defaultFamilyRbacPolicyConfig()),
      'ALLOW_WITH_STEP_UP',
      `${operation} is documented configurable with a safe default of OFF; this records what actually happens under the default config`,
    );
  }
});

test('owner architecture: ADD_ADMINISTRATOR / CHANGE_ROLE are normal role administration with step-up', () => {
  for (const op of ['ADD_ADMINISTRATOR', 'CHANGE_ROLE']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, CONFIGURED), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('VIEWER', op, CONFIGURED), 'DENY');
    assert.equal(resolveOperationAuthorization('CHILD', op, CONFIGURED), 'DENY');
  }
});

test('doc 18 table row: CHANGE_RETENTION / DELETE_NOW / EXPORT_FAMILY_DATA -- Owner-only, step-up, Administrator "no by default" is never configurable', () => {
  for (const op of ['CHANGE_RETENTION', 'DELETE_NOW', 'EXPORT_FAMILY_DATA']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW_WITH_STEP_UP');
    // Unlike ADD_VIEWER/REMOVE_REVOKE_DEVICE, this row has NO configurable escalation path for Administrator at all.
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, CONFIGURED), 'DENY');
  }
});

test('owner architecture: REMOVE_REVOKE_DEVICE / DISABLE_PROTECTION_POLICY are normal Administrator device administration', () => {
  for (const op of ['REMOVE_REVOKE_DEVICE', 'DISABLE_PROTECTION_POLICY']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, defaultFamilyRbacPolicyConfig()), 'ALLOW_WITH_STEP_UP');
  }
});

test('doc 18 table row: OWNERSHIP_TRANSFER_INITIATION / RECOVERY_SENSITIVE_ACTION -- Owner only, never Administrator regardless of config', () => {
  for (const op of ['OWNERSHIP_TRANSFER_INITIATION', 'RECOVERY_SENSITIVE_ACTION']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, CONFIGURED), 'DENY');
    assert.equal(resolveOperationAuthorization('VIEWER', op, CONFIGURED), 'DENY');
    assert.equal(resolveOperationAuthorization('CHILD', op, CONFIGURED), 'DENY');
  }
});

test('isRoleChangeTargetAllowed rejects OWNER as a CHANGE_ROLE target -- ownership transfer cannot be emulated by role mutation', () => {
  assert.equal(isRoleChangeTargetAllowed('OWNER'), false);
  assert.equal(isRoleChangeTargetAllowed('ADMINISTRATOR'), true);
  assert.equal(isRoleChangeTargetAllowed('VIEWER'), true);
  assert.equal(isRoleChangeTargetAllowed('CHILD'), true);
});

test('resolveOperationAuthorization default-denies an unrecognized operation string', () => {
  assert.equal(resolveOperationAuthorization('OWNER', 'NOT_A_REAL_OPERATION', defaultFamilyRbacPolicyConfig()), 'DENY');
});

test('requiresStepUp / isRequestOnly are precise predicates', () => {
  assert.equal(requiresStepUp('ALLOW_WITH_STEP_UP'), true);
  assert.equal(requiresStepUp('ALLOW'), false);
  assert.equal(isRequestOnly('REQUEST_ONLY'), true);
  assert.equal(isRequestOnly('ALLOW'), false);
});

// --- deriveDeliveryStatus ---

const T0 = new Date('2026-01-01T00:00:00Z');
const EXPIRES = new Date('2026-01-01T00:15:00Z');

test('deliveryStatus: no acks yet, not expired -> PENDING_DELIVERY (never APPLIED just because the initiator accepted)', () => {
  const status = deriveDeliveryStatus('act-1', 5, ['dev-1'], [], [], T0, EXPIRES);
  assert.equal(status, 'PENDING_DELIVERY');
});

test('deliveryStatus: all targets ack success at the correct epoch -> APPLIED', () => {
  const acks = [{ deviceId: 'dev-1', acknowledgedActionId: 'act-1', acknowledgedTrustSetEpoch: 5, acknowledgedAt: T0, outcome: 'ACK_SUCCESS' }];
  assert.equal(deriveDeliveryStatus('act-1', 5, ['dev-1'], acks, [], T0, EXPIRES), 'APPLIED');
});

test('deliveryStatus: an ack for the WRONG epoch never counts as APPLIED', () => {
  const acks = [{ deviceId: 'dev-1', acknowledgedActionId: 'act-1', acknowledgedTrustSetEpoch: 4, acknowledgedAt: T0, outcome: 'ACK_SUCCESS' }];
  assert.notEqual(deriveDeliveryStatus('act-1', 5, ['dev-1'], acks, [], T0, EXPIRES), 'APPLIED');
});

test('deliveryStatus: one of two targets acks -> PARTIALLY_APPLIED, never APPLIED', () => {
  const acks = [{ deviceId: 'dev-1', acknowledgedActionId: 'act-1', acknowledgedTrustSetEpoch: 5, acknowledgedAt: T0, outcome: 'ACK_SUCCESS' }];
  assert.equal(deriveDeliveryStatus('act-1', 5, ['dev-1', 'dev-2'], acks, [], T0, EXPIRES), 'PARTIALLY_APPLIED');
});

test('deliveryStatus: a REVOKED ack outranks everything else', () => {
  const acks = [{ deviceId: 'dev-1', acknowledgedActionId: 'act-1', acknowledgedTrustSetEpoch: 5, acknowledgedAt: T0, outcome: 'ACK_REJECTED_REVOKED' }];
  assert.equal(deriveDeliveryStatus('act-1', 5, ['dev-1'], acks, [], T0, EXPIRES), 'REVOKED');
});

test('deliveryStatus: a stale-epoch rejection with no success -> EPOCH_STALE', () => {
  const acks = [{ deviceId: 'dev-1', acknowledgedActionId: 'act-1', acknowledgedTrustSetEpoch: 4, acknowledgedAt: T0, outcome: 'ACK_REJECTED_STALE_EPOCH' }];
  assert.equal(deriveDeliveryStatus('act-1', 5, ['dev-1'], acks, [], T0, EXPIRES), 'EPOCH_STALE');
});

test('deliveryStatus: past expiry with no success -> FAILED', () => {
  const late = new Date('2026-01-01T00:20:00Z');
  assert.equal(deriveDeliveryStatus('act-1', 5, ['dev-1'], [], [], late, EXPIRES), 'FAILED');
});

test('deliveryStatus: unacked target known offline -> DEVICE_OFFLINE', () => {
  assert.equal(deriveDeliveryStatus('act-1', 5, ['dev-1'], [], ['dev-1'], T0, EXPIRES), 'DEVICE_OFFLINE');
});

test('deliveryStatus: unrelated acks for a different actionId are ignored', () => {
  const acks = [{ deviceId: 'dev-1', acknowledgedActionId: 'other-action', acknowledgedTrustSetEpoch: 5, acknowledgedAt: T0, outcome: 'ACK_SUCCESS' }];
  assert.equal(deriveDeliveryStatus('act-1', 5, ['dev-1'], acks, [], T0, EXPIRES), 'PENDING_DELIVERY');
});
