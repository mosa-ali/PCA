import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('doc 18 table row: ADD_VIEWER / REMOVE_NON_OWNER_PARENT -- Administrator is DENY unless configured, safe default off', () => {
  for (const op of ['ADD_VIEWER', 'REMOVE_NON_OWNER_PARENT']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, defaultFamilyRbacPolicyConfig()), 'DENY');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, CONFIGURED), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('VIEWER', op, CONFIGURED), 'DENY');
    assert.equal(resolveOperationAuthorization('CHILD', op, CONFIGURED), 'DENY');
  }
});

test('doc 18 table row: ADD_ADMINISTRATOR / CHANGE_ROLE -- Owner only, with step-up, never Administrator', () => {
  for (const op of ['ADD_ADMINISTRATOR', 'CHANGE_ROLE']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, CONFIGURED), 'DENY');
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

test('doc 18 table row: REMOVE_REVOKE_DEVICE / DISABLE_PROTECTION_POLICY -- Administrator configurable, safe default off', () => {
  for (const op of ['REMOVE_REVOKE_DEVICE', 'DISABLE_PROTECTION_POLICY']) {
    assert.equal(resolveOperationAuthorization('OWNER', op, defaultFamilyRbacPolicyConfig()), 'ALLOW_WITH_STEP_UP');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, defaultFamilyRbacPolicyConfig()), 'DENY');
    assert.equal(resolveOperationAuthorization('ADMINISTRATOR', op, CONFIGURED), 'ALLOW_WITH_STEP_UP');
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
