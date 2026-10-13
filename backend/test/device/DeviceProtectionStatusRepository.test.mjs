import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryDeviceProtectionStatusRepository,
  ProtectionStatusDeviceUnavailableError,
  ProtectionStatusStaleReportError,
} from '../../dist/device/DeviceProtectionStatusRepository.js';

test('in-memory protection status keeps its server receipt time isolated from mutable caller Dates', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const receivedAt = new Date('2026-10-09T12:00:00.000Z');
  await repository.upsert({
    deviceId: 'device-one',
    familyId: 'family-one',
    protectionLevel: 'PROTECTED',
    updatedAt: receivedAt,
  });

  // Mutating the caller's original Date after upsert must not refresh the
  // stored report and make an old device state look newly received.
  receivedAt.setTime(Date.parse('2036-10-09T12:00:00.000Z'));
  const firstRead = await repository.findForDevice('family-one', 'device-one');
  assert.ok(firstRead);
  assert.equal(firstRead.updatedAt.toISOString(), '2026-10-09T12:00:00.000Z');

  // A read must also be a snapshot: downstream mutation cannot rewrite the
  // repository's timestamp and thereby alter freshness decisions elsewhere.
  firstRead.updatedAt.setTime(Date.parse('2036-10-09T12:00:00.000Z'));
  const secondRead = await repository.findForDevice('family-one', 'device-one');
  assert.ok(secondRead);
  assert.equal(secondRead.updatedAt.toISOString(), '2026-10-09T12:00:00.000Z');
  assert.equal(await repository.findForDevice('another-family', 'device-one'), null);
});

test('in-memory recordAndReadPrevious serializes concurrent status transitions', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const record = (protectionLevel) => ({
    deviceId: 'device-one',
    familyId: 'family-one',
    protectionLevel,
    updatedAt: new Date(),
  });
  await repository.upsert(record('PROTECTED'));

  const prior = await Promise.all([
    repository.recordAndReadPrevious(record('DEGRADED')),
    repository.recordAndReadPrevious(record('DEGRADED')),
  ]);

  assert.deepEqual(prior.map((item) => item?.protectionLevel).sort(), ['DEGRADED', 'PROTECTED']);
  assert.equal((await repository.findForDevice('family-one', 'device-one'))?.protectionLevel, 'DEGRADED');
});

test('in-memory status writes reject a device ID presented under another family', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const original = {
    deviceId: 'device-one',
    familyId: 'family-one',
    protectionLevel: 'PROTECTED',
    updatedAt: new Date('2026-10-09T12:00:00.000Z'),
  };
  await repository.upsert(original);
  const foreign = { ...original, familyId: 'family-two', protectionLevel: 'DEGRADED', updatedAt: new Date('2026-10-09T12:01:00.000Z') };

  await assert.rejects(repository.upsert(foreign), ProtectionStatusDeviceUnavailableError);
  await assert.rejects(repository.recordAndReadPrevious(foreign), ProtectionStatusDeviceUnavailableError);
  assert.deepEqual(await repository.findForDevice(original.familyId, original.deviceId), original);
  assert.equal(await repository.findForDevice(foreign.familyId, foreign.deviceId), null);
});

test('protection status repositories reject invalid receipt dates and runtime levels', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const record = (overrides = {}) => ({
    deviceId: 'device-one',
    familyId: 'family-one',
    protectionLevel: 'PROTECTED',
    updatedAt: new Date('2026-10-09T12:00:00.000Z'),
    ...overrides,
  });

  await assert.rejects(repository.upsert(record({ updatedAt: new Date(Number.NaN) })), TypeError);
  await assert.rejects(repository.upsert(record({ updatedAt: new Date('0999-12-31T23:59:59.999Z') })), TypeError);
  await assert.rejects(repository.upsert(record({ updatedAt: new Date('10000-01-01T00:00:00.000Z') })), TypeError);
  await assert.rejects(repository.upsert(record({ updatedAt: '2026-10-09T12:00:00.000Z' })), TypeError);
  await assert.rejects(repository.upsert(record({ protectionLevel: 'ACTIVE' })), TypeError);
  assert.equal(await repository.findForDevice('family-one', 'device-one'), null);
});

test('in-memory status does not let an older server receipt roll back the latest protection state', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const received = (protectionLevel, updatedAt) => ({
    deviceId: 'device-one',
    familyId: 'family-one',
    protectionLevel,
    updatedAt: new Date(updatedAt),
  });

  await repository.upsert(received('DEGRADED', '2026-10-09T12:00:01.000Z'));
  await assert.rejects(
    repository.recordAndReadPrevious(received('PROTECTED', '2026-10-09T12:00:00.000Z')),
    ProtectionStatusStaleReportError,
  );
  const current = await repository.findForDevice('family-one', 'device-one');
  assert.equal(current?.protectionLevel, 'DEGRADED');
  assert.equal(current?.updatedAt.toISOString(), '2026-10-09T12:00:01.000Z');
});

test('authority snapshots require an exact DSK key identifier and valid accepted epochs', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const record = {
    deviceId: 'device-one',
    familyId: 'family-one',
    protectionLevel: 'PROTECTED',
    updatedAt: new Date('2026-10-09T12:00:00.000Z'),
  };

  await assert.rejects(repository.upsert(record, {
    dskKeyId: 'invalid key id', trustSetEpoch: 1, keyEpoch: 1,
  }), TypeError);
  await assert.rejects(repository.upsert(record, {
    dskKeyId: '00000000-0000-4000-8000-000000000001', trustSetEpoch: 0, keyEpoch: 1,
  }), TypeError);
  assert.equal(await repository.findForDevice('family-one', 'device-one'), null);
});
