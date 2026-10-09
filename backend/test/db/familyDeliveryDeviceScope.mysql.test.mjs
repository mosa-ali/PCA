// Disposable-MySQL coverage for the durable opaque FamilyAudit and
// ProtectionAlert queues. HTTP route tests separately prove that the bearer
// session resolves to the parentDeviceId passed to these list methods.
// This test proves the MySQL persistence boundary applies BOTH family and
// parent-device scope, while exact retries remain idempotent and byte-stable.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { closePool } from '../../dist/db/pool.js';
import { MySqlFamilyAuditEventLedger } from '../../dist/familyrbac/MySqlFamilyAuditEventLedger.js';
import { MySqlProtectionAlertLedger } from '../../dist/alerts/MySqlProtectionAlertLedger.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const READ_NOW = new Date(Date.now() - 1000);
const familyAuditLedger = new MySqlFamilyAuditEventLedger(() => READ_NOW);
const protectionAlertLedger = new MySqlProtectionAlertLedger(() => READ_NOW);

function familyAuditEnvelope(overrides = {}) {
  return {
    envelopeId: `envelope-${randomUUID()}`,
    familyId: `family-${randomUUID()}`,
    parentDeviceId: `parent-${randomUUID()}`,
    keyEpoch: 7,
    generatedAtUtc: new Date(READ_NOW),
    encryptedPayloadB64: `opaque-ciphertext-${randomUUID()}`,
    nonceB64: `opaque-nonce-${randomUUID()}`,
    ...overrides,
  };
}

function protectionAlert(overrides = {}) {
  return {
    alertId: `alert-${randomUUID()}`,
    familyId: `family-${randomUUID()}`,
    deviceId: `child-${randomUUID()}`,
    parentDeviceId: `parent-${randomUUID()}`,
    trigger: 'PROTECTION_DEGRADED',
    keyEpoch: 7,
    generatedAtUtc: new Date(READ_NOW),
    encryptedPayloadB64: `opaque-ciphertext-${randomUUID()}`,
    nonceB64: `opaque-nonce-${randomUUID()}`,
    ...overrides,
  };
}

test('MySQL FamilyAudit queue is family-and-parent-device scoped and exact retry is stable', async () => {
  const familyId = `family-${randomUUID()}`;
  const otherFamilyId = `family-${randomUUID()}`;
  const actorParentDeviceId = `parent-${randomUUID()}`;
  const otherParentDeviceId = `parent-${randomUUID()}`;
  const actorEnvelope = familyAuditEnvelope({ familyId, parentDeviceId: actorParentDeviceId });
  const sameFamilyOtherDevice = familyAuditEnvelope({ familyId, parentDeviceId: otherParentDeviceId });
  const otherFamilySameDevice = familyAuditEnvelope({ familyId: otherFamilyId, parentDeviceId: actorParentDeviceId });

  assert.deepEqual(await familyAuditLedger.record(actorEnvelope), { outcome: 'RECORDED' });
  assert.deepEqual(await familyAuditLedger.record(sameFamilyOtherDevice), { outcome: 'RECORDED' });
  assert.deepEqual(await familyAuditLedger.record(otherFamilySameDevice), { outcome: 'RECORDED' });
  assert.deepEqual(await familyAuditLedger.record(actorEnvelope), { outcome: 'IDEMPOTENT_MATCH' });
  assert.deepEqual(
    await familyAuditLedger.record({ ...actorEnvelope, encryptedPayloadB64: 'different-ciphertext' }),
    { outcome: 'CONFLICT' },
  );

  assert.deepEqual(await familyAuditLedger.get(actorEnvelope.envelopeId), actorEnvelope);
  assert.deepEqual(
    await familyAuditLedger.listForParentDevice(familyId, actorParentDeviceId, { now: READ_NOW }),
    [actorEnvelope],
  );
  assert.deepEqual(
    await familyAuditLedger.listForParentDevice(familyId, otherParentDeviceId, { now: READ_NOW }),
    [sameFamilyOtherDevice],
  );
  assert.deepEqual(
    await familyAuditLedger.listForParentDevice(otherFamilyId, actorParentDeviceId, { now: READ_NOW }),
    [otherFamilySameDevice],
  );
});

test('MySQL ProtectionAlert queue is family-and-parent-device scoped and exact retry is stable', async () => {
  const familyId = `family-${randomUUID()}`;
  const otherFamilyId = `family-${randomUUID()}`;
  const actorParentDeviceId = `parent-${randomUUID()}`;
  const otherParentDeviceId = `parent-${randomUUID()}`;
  const actorAlert = protectionAlert({ familyId, parentDeviceId: actorParentDeviceId });
  const sameFamilyOtherDevice = protectionAlert({ familyId, parentDeviceId: otherParentDeviceId });
  const otherFamilySameDevice = protectionAlert({ familyId: otherFamilyId, parentDeviceId: actorParentDeviceId });

  assert.deepEqual(await protectionAlertLedger.record(actorAlert), { outcome: 'RECORDED' });
  assert.deepEqual(await protectionAlertLedger.record(sameFamilyOtherDevice), { outcome: 'RECORDED' });
  assert.deepEqual(await protectionAlertLedger.record(otherFamilySameDevice), { outcome: 'RECORDED' });
  assert.deepEqual(await protectionAlertLedger.record(actorAlert), { outcome: 'IDEMPOTENT_MATCH' });
  assert.deepEqual(
    await protectionAlertLedger.record({ ...actorAlert, encryptedPayloadB64: 'different-ciphertext' }),
    { outcome: 'CONFLICT' },
  );

  assert.deepEqual(await protectionAlertLedger.get(actorAlert.alertId), actorAlert);
  assert.deepEqual(
    await protectionAlertLedger.listForParentDevice(familyId, actorParentDeviceId, { now: READ_NOW }),
    [actorAlert],
  );
  assert.deepEqual(
    await protectionAlertLedger.listForParentDevice(familyId, otherParentDeviceId, { now: READ_NOW }),
    [sameFamilyOtherDevice],
  );
  assert.deepEqual(
    await protectionAlertLedger.listForParentDevice(otherFamilyId, actorParentDeviceId, { now: READ_NOW }),
    [otherFamilySameDevice],
  );
});

after(async () => {
  await closePool();
});
