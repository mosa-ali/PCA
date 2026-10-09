import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryDeviceProtectionStatusRepository } from '../../dist/device/DeviceProtectionStatusRepository.js';

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
