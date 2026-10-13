import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateProtectionAlert,
  InvalidProtectionAlertInputError,
} from '../../dist/alerts/ProtectionAlertGenerator.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-08-19T12:00:00.000Z');

const BASE = {
  alertId: 'alert-1',
  familyId: 'family-1',
  deviceId: 'device-1',
  parentDeviceId: 'parent-1',
  trigger: 'PROTECTION_DEGRADED',
  keyEpoch: 3,
  generatedAtUtc: new Date('2026-08-19T12:00:00.000Z'),
  encryptedPayloadB64: 'AQID',
  nonceB64: 'BAUG',
  alertsEnabled: true,
};

test('PCA-ADD-ENR-020 creates opaque typed events and remains disabled by default', () => {
  assert.equal(generateProtectionAlert({ ...BASE, alertsEnabled: false }), null);
  const event = generateProtectionAlert(BASE);
  assert.equal(event?.trigger, 'PROTECTION_DEGRADED');
  assert.equal(event?.encryptedPayloadB64, 'AQID');
  assert.equal('plaintext' in event, false);
});

test('PCA-ADD-ENR-020 requires encrypted payloads and device identity for device-scoped triggers', () => {
  assert.throws(
    () => generateProtectionAlert({ ...BASE, encryptedPayloadB64: 'not-base64' }),
    InvalidProtectionAlertInputError,
  );
  assert.throws(
    () => generateProtectionAlert({ ...BASE, deviceId: null }),
    /requires a deviceId/,
  );
  const invitation = generateProtectionAlert({ ...BASE, deviceId: null, trigger: 'INVITATION_REDEEMED' });
  assert.equal(invitation?.deviceId, null);
});

test('PCA-ADD-ENR-020 rejects dates outside the MySQL retained-window range', () => {
  const latestPersistable = new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999) - 7 * 24 * 60 * 60 * 1000);
  for (const generatedAtUtc of [
    new Date('0999-12-31T23:59:59.999Z'),
    new Date(latestPersistable.getTime() + 1),
  ]) {
    assert.throws(
      () => generateProtectionAlert({ ...BASE, generatedAtUtc }),
      InvalidProtectionAlertInputError,
    );
  }
  assert.equal(generateProtectionAlert({ ...BASE, generatedAtUtc: latestPersistable })?.generatedAtUtc.getTime(), latestPersistable.getTime());
});

test('PCA-ADD-ENR-020 ledger is append-only and idempotent without a plaintext read path', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const event = generateProtectionAlert(BASE);
  assert.ok(event);
  assert.deepEqual(await ledger.record(event), { outcome: 'RECORDED' });
  assert.deepEqual(await ledger.record(event), { outcome: 'IDEMPOTENT_MATCH' });
  assert.deepEqual(
    await ledger.record({ ...event, encryptedPayloadB64: 'CQkJ' }),
    { outcome: 'CONFLICT' },
  );
  assert.deepEqual((await ledger.listForParentDevice('family-1', 'parent-1', 3)).map((item) => item.alertId), ['alert-1']);
});

test('in-memory ledger matches MySQL persistence bounds and has no effects on rejection', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const latestPersistable = new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999) - 7 * 24 * 60 * 60 * 1000);
  for (const generatedAtUtc of [
    new Date('0999-12-31T23:59:59.999Z'),
    new Date(latestPersistable.getTime() + 1),
  ]) {
    const event = { ...generateProtectionAlert(BASE), alertId: `invalid-${generatedAtUtc.getTime()}`, generatedAtUtc };
    await assert.rejects(ledger.record(event), InvalidProtectionAlertInputError);
    assert.equal(await ledger.get(event.alertId), null);
  }
});

test('parent-device feed returns only ciphertext at the authenticated current key epoch', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const current = generateProtectionAlert({ ...BASE, alertId: 'alert-current-epoch', keyEpoch: 3 });
  const stale = generateProtectionAlert({ ...BASE, alertId: 'alert-stale-epoch', keyEpoch: 2 });
  const future = generateProtectionAlert({ ...BASE, alertId: 'alert-future-epoch', keyEpoch: 4 });
  await ledger.record(current);
  await ledger.record(stale);
  await ledger.record(future);

  assert.deepEqual(await ledger.listForParentDevice('family-1', 'parent-1', 3), [current]);
  await assert.rejects(
    () => ledger.listForParentDevice('family-1', 'parent-1', 0),
    /key epoch is outside the supported family epoch range/,
  );
});

test('ledger snapshots event routing and opaque bytes before awaiting expiry cleanup', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const event = generateProtectionAlert({ ...BASE, generatedAtUtc: new Date(LEDGER_NOW.getTime()) });
  const pendingRecord = ledger.record(event);

  event.alertId = 'mutated-alert';
  event.familyId = 'family-other';
  event.deviceId = 'device-other';
  event.parentDeviceId = 'parent-other';
  event.generatedAtUtc.setTime(Date.parse('2026-08-20T12:00:00.000Z'));
  event.encryptedPayloadB64 = 'mutated-ciphertext';
  event.nonceB64 = 'mutated-nonce';

  assert.deepEqual(await pendingRecord, { outcome: 'RECORDED' });
  const retained = await ledger.get('alert-1');
  assert.equal(retained.familyId, 'family-1');
  assert.equal(retained.deviceId, 'device-1');
  assert.equal(retained.parentDeviceId, 'parent-1');
  assert.equal(retained.generatedAtUtc.toISOString(), LEDGER_NOW.toISOString());
  assert.equal(retained.encryptedPayloadB64, 'AQID');
  assert.equal(retained.nonceB64, 'BAUG');
  assert.deepEqual(await ledger.listForParentDevice('family-1', 'parent-1', 3).then((rows) => rows.map((row) => row.alertId)), ['alert-1']);
  assert.deepEqual(await ledger.listForParentDevice('family-other', 'parent-other', 3), []);
});

test('get and both list methods return detached event and timestamp snapshots', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const original = generateProtectionAlert({ ...BASE, generatedAtUtc: new Date(LEDGER_NOW.getTime()) });
  await ledger.record(original);

  const fromGet = await ledger.get(original.alertId);
  const fromFamilyList = (await ledger.listForFamily('family-1'))[0];
  const fromDeviceList = (await ledger.listForParentDevice('family-1', 'parent-1', original.keyEpoch))[0];
  fromGet.familyId = 'family-other';
  fromGet.parentDeviceId = 'parent-other';
  fromGet.generatedAtUtc.setTime(0);
  fromGet.encryptedPayloadB64 = 'changed';
  fromFamilyList.nonceB64 = 'changed';
  fromFamilyList.generatedAtUtc.setTime(0);
  fromDeviceList.deviceId = 'device-other';
  fromDeviceList.generatedAtUtc.setTime(0);

  const retained = await ledger.get(original.alertId);
  assert.equal(retained.familyId, 'family-1');
  assert.equal(retained.parentDeviceId, 'parent-1');
  assert.equal(retained.deviceId, 'device-1');
  assert.equal(retained.generatedAtUtc.toISOString(), LEDGER_NOW.toISOString());
  assert.equal(retained.encryptedPayloadB64, 'AQID');
  assert.equal(retained.nonceB64, 'BAUG');
  assert.deepEqual(await ledger.record(original), { outcome: 'IDEMPOTENT_MATCH' });
});
