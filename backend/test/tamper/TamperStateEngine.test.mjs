import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeConvergenceState,
  computeOverallState,
  computeOpenConditions,
  detectTamperCondition,
} from '../../dist/tamper/TamperStateEngine.js';
import { CONDITION_POLICY } from '../../dist/tamper/policy.js';
import { InMemoryTamperEventLedger } from '../../dist/tamper/TamperEventLedger.js';

function baseInput(overrides = {}) {
  return {
    eventId: 'event-1',
    familyId: 'family-1',
    deviceId: 'device-1',
    trustSetEpoch: 1,
    keyEpoch: 1,
    detectedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    condition: 'USAGE_PERMISSION_LOST',
    evidenceClass: 'PLATFORM_CAPABILITY_CALLBACK',
    localSequence: 0,
    detailCiphertext: null,
    ...overrides,
  };
}

// --- Every condition maps to doc 21's required state/severity --------------

test('every condition in the policy table has a defined state and severity (exhaustive by construction)', () => {
  for (const [condition, policy] of Object.entries(CONDITION_POLICY)) {
    assert.ok(policy.state, `${condition} missing state`);
    assert.ok(policy.severity, `${condition} missing severity`);
  }
});

test('capability-loss conditions map to DEGRADED (doc 21 Section 3 row 1)', () => {
  for (const condition of [
    'USAGE_PERMISSION_LOST',
    'NOTIFICATION_CAPABILITY_LOST',
    'LOCATION_CAPABILITY_LOST',
    'VPN_FILTER_CAPABILITY_LOST',
    'DPC_AUTHORITY_LOST',
  ]) {
    assert.equal(CONDITION_POLICY[condition].state, 'DEGRADED');
  }
});

test('envelope-anomaly conditions map to SUSPECTED_TAMPER/SECURITY_CRITICAL (doc 21 Section 3 row 3)', () => {
  for (const condition of ['INVALID_ENVELOPE', 'REPLAYED_ENVELOPE', 'EXPIRED_ENVELOPE', 'WRONG_TRUST_OR_KEY_EPOCH', 'UNAUTHORIZED_SENDER']) {
    assert.equal(CONDITION_POLICY[condition].state, 'SUSPECTED_TAMPER');
    assert.equal(CONDITION_POLICY[condition].severity, 'SECURITY_CRITICAL');
  }
});

test('recovery-material-stolen maps to RECOVERY_REQUIRED (doc 21 Section 3 row 7)', () => {
  assert.equal(CONDITION_POLICY.RECOVERY_MATERIAL_OR_DEVICE_SUSPECTED_STOLEN.state, 'RECOVERY_REQUIRED');
});

test('hardware-key-assurance-loss is a lower-confidence signal (ACTION_REQUIRED, not SECURITY_CRITICAL) -- no comprehensive-detection overclaim', () => {
  assert.equal(CONDITION_POLICY.HARDWARE_KEY_ASSURANCE_LOST.state, 'SUSPECTED_TAMPER');
  assert.equal(CONDITION_POLICY.HARDWARE_KEY_ASSURANCE_LOST.severity, 'ACTION_REQUIRED');
});

// --- detectTamperCondition never accuses/deletes/changes policy ------------

test('a detected condition records exactly the doc 21 event contract fields, nothing more', async () => {
  const ledger = new InMemoryTamperEventLedger();
  const { event, recordResult } = await detectTamperCondition(baseInput(), ledger);

  assert.equal(recordResult.outcome, 'RECORDED');
  assert.equal(event.status, 'OPEN');
  assert.equal(event.severity, 'ACTION_REQUIRED');
  assert.deepEqual(Object.keys(event).sort(), [
    'condition',
    'detailCiphertext',
    'detectedAtUtc',
    'deviceId',
    'eventId',
    'evidenceClass',
    'familyId',
    'keyEpoch',
    'localSequence',
    'severity',
    'status',
    'trustSetEpoch',
  ]);
});

test('recording the same eventId twice with identical content is idempotent (retried local write)', async () => {
  const ledger = new InMemoryTamperEventLedger();
  await detectTamperCondition(baseInput(), ledger);
  const second = await detectTamperCondition(baseInput(), ledger);

  assert.equal(second.recordResult.outcome, 'IDEMPOTENT_MATCH');
});

test('recording a DIFFERENT event under an already-used eventId is a CONFLICT, never a silent overwrite', async () => {
  const ledger = new InMemoryTamperEventLedger();
  await detectTamperCondition(baseInput(), ledger);
  const conflicting = await detectTamperCondition(baseInput({ condition: 'CLOCK_ROLLBACK' }), ledger);

  assert.equal(conflicting.recordResult.outcome, 'CONFLICT');
  const stored = await ledger.getEvent('event-1');
  assert.equal(stored.condition, 'USAGE_PERMISSION_LOST'); // unchanged
});

test('acknowledging an event marks it ACKNOWLEDGED but does not clear it from open conditions (doc 21: cannot suppress the underlying state)', async () => {
  const ledger = new InMemoryTamperEventLedger();
  await detectTamperCondition(baseInput(), ledger);
  const acknowledged = await ledger.recordAcknowledgement('event-1', 'parent-1');

  assert.equal(acknowledged.status, 'ACKNOWLEDGED');
  const openConditions = computeOpenConditions([acknowledged]);
  assert.deepEqual(openConditions, ['USAGE_PERMISSION_LOST']); // still open
});

test('only an explicit RESOLVED event removes a condition from the open set -- acknowledgement alone never does', async () => {
  const ledger = new InMemoryTamperEventLedger();
  await detectTamperCondition(baseInput(), ledger);
  await ledger.recordAcknowledgement('event-1', 'parent-1');
  const resolved = await ledger.recordResolution('event-1');

  const openConditions = computeOpenConditions([resolved]);
  assert.deepEqual(openConditions, []);
});

test('TamperEventLedger exposes no update/delete of event content -- append-only by interface shape', async () => {
  const ledger = new InMemoryTamperEventLedger();
  const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(ledger)).filter((m) => m !== 'constructor');
  assert.ok(!methodNames.some((m) => /delete|remove|update/i.test(m)));
});

// --- Overall state precedence -----------------------------------------------

test('a device with no open conditions and full convergence is HEALTHY', () => {
  assert.equal(computeOverallState([], 'HEALTHY'), 'HEALTHY');
});

test('an open DEGRADED condition alone yields DEGRADED overall', () => {
  assert.equal(computeOverallState(['USAGE_PERMISSION_LOST'], 'HEALTHY'), 'DEGRADED');
});

test('SUSPECTED_TAMPER outranks a simultaneously-open DEGRADED condition -- never silently masked by the milder signal', () => {
  const overall = computeOverallState(['USAGE_PERMISSION_LOST', 'REPLAYED_ENVELOPE'], 'HEALTHY');
  assert.equal(overall, 'SUSPECTED_TAMPER');
});

test('RECOVERY_REQUIRED outranks SUSPECTED_TAMPER', () => {
  const overall = computeOverallState(['REPLAYED_ENVELOPE', 'RECOVERY_MATERIAL_OR_DEVICE_SUSPECTED_STOLEN'], 'HEALTHY');
  assert.equal(overall, 'RECOVERY_REQUIRED');
});

test('REVOKED (convergence) outranks every open condition, including RECOVERY_REQUIRED', () => {
  const overall = computeOverallState(['RECOVERY_MATERIAL_OR_DEVICE_SUSPECTED_STOLEN'], 'REVOKED');
  assert.equal(overall, 'REVOKED');
});

test('a convergence lag (EPOCH_STALE) outranks a mere DEGRADED capability loss', () => {
  const overall = computeOverallState(['USAGE_PERMISSION_LOST'], 'EPOCH_STALE');
  assert.equal(overall, 'EPOCH_STALE');
});

// --- Epoch convergence -------------------------------------------------------

test('a device fully caught up on both epochs, connected, is HEALTHY convergence', () => {
  const state = computeConvergenceState({
    isTransportConnected: true,
    localTrustSetEpoch: 3,
    localKeyEpoch: 3,
    latestKnownTrustSetEpoch: 3,
    latestKnownKeyEpoch: 3,
    isDeviceRevokedInLatestKnownEpoch: false,
  });
  assert.equal(state, 'HEALTHY');
});

test('behind on trustSetEpoch but connected is EPOCH_STALE, not DEVICE_OFFLINE', () => {
  const state = computeConvergenceState({
    isTransportConnected: true,
    localTrustSetEpoch: 2,
    localKeyEpoch: 3,
    latestKnownTrustSetEpoch: 3,
    latestKnownKeyEpoch: 3,
    isDeviceRevokedInLatestKnownEpoch: false,
  });
  assert.equal(state, 'EPOCH_STALE');
});

test('behind on keyEpoch specifically (trustSetEpoch caught up) is still a convergence lag', () => {
  const state = computeConvergenceState({
    isTransportConnected: true,
    localTrustSetEpoch: 3,
    localKeyEpoch: 2,
    latestKnownTrustSetEpoch: 3,
    latestKnownKeyEpoch: 3,
    isDeviceRevokedInLatestKnownEpoch: false,
  });
  assert.equal(state, 'EPOCH_STALE');
});

test('behind and NOT connected is DEVICE_OFFLINE, distinct from EPOCH_STALE', () => {
  const state = computeConvergenceState({
    isTransportConnected: false,
    localTrustSetEpoch: 2,
    localKeyEpoch: 2,
    latestKnownTrustSetEpoch: 3,
    latestKnownKeyEpoch: 3,
    isDeviceRevokedInLatestKnownEpoch: false,
  });
  assert.equal(state, 'DEVICE_OFFLINE');
});

test('a revoked device is REVOKED regardless of connectivity or epoch numbers', () => {
  const state = computeConvergenceState({
    isTransportConnected: true,
    localTrustSetEpoch: 5,
    localKeyEpoch: 5,
    latestKnownTrustSetEpoch: 5,
    latestKnownKeyEpoch: 5,
    isDeviceRevokedInLatestKnownEpoch: true,
  });
  assert.equal(state, 'REVOKED');
});

test('an offline device that is nonetheless fully caught up is HEALTHY, not DEVICE_OFFLINE -- offline alone is not a tamper state', () => {
  const state = computeConvergenceState({
    isTransportConnected: false,
    localTrustSetEpoch: 3,
    localKeyEpoch: 3,
    latestKnownTrustSetEpoch: 3,
    latestKnownKeyEpoch: 3,
    isDeviceRevokedInLatestKnownEpoch: false,
  });
  assert.equal(state, 'HEALTHY');
});
