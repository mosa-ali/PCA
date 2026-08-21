// PCA-ADD-ENR-016/PCA-FR-145: RealProtectiveAuthorityResolver replaces
// UnavailableProtectiveAuthorityResolver's unconditional `false` with a
// real read of device_protection_status. This file proves the resolver's
// own logic (family/device matching, freshness bound, protection-level
// interpretation) independent of the device-session-authenticated write
// path (covered separately in runtimeSyncRoutes tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryDeviceProtectionStatusRepository } from '../../dist/device/DeviceProtectionStatusRepository.js';
import { RealProtectiveAuthorityResolver } from '../../dist/familyrbac/RealProtectiveAuthorityResolver.js';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const FAMILY = 'family-pa-1';
const DEVICE = 'device-pa-1';

test('no reported status at all resolves to false (never assume PROTECTED)', async () => {
  const resolver = new RealProtectiveAuthorityResolver(new InMemoryDeviceProtectionStatusRepository(), { now: () => NOW });
  assert.equal(await resolver.resolve(FAMILY, DEVICE), false);
});

test('a fresh PROTECTED report resolves to true', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  await repository.upsert({ deviceId: DEVICE, familyId: FAMILY, protectionLevel: 'PROTECTED', updatedAt: new Date(NOW.getTime() - 60_000) });
  const resolver = new RealProtectiveAuthorityResolver(repository, { now: () => NOW });
  assert.equal(await resolver.resolve(FAMILY, DEVICE), true);
});

test('a fresh DEGRADED report still resolves to true (still under some management authority, just impaired)', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  await repository.upsert({ deviceId: DEVICE, familyId: FAMILY, protectionLevel: 'DEGRADED', updatedAt: new Date(NOW.getTime() - 60_000) });
  const resolver = new RealProtectiveAuthorityResolver(repository, { now: () => NOW });
  assert.equal(await resolver.resolve(FAMILY, DEVICE), true);
});

for (const level of ['STANDARD', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED']) {
  test(`a fresh ${level} report resolves to false (no protective authority to gate a removal decision behind)`, async () => {
    const repository = new InMemoryDeviceProtectionStatusRepository();
    await repository.upsert({ deviceId: DEVICE, familyId: FAMILY, protectionLevel: level, updatedAt: new Date(NOW.getTime() - 60_000) });
    const resolver = new RealProtectiveAuthorityResolver(repository, { now: () => NOW });
    assert.equal(await resolver.resolve(FAMILY, DEVICE), false);
  });
}

test('a stale PROTECTED report (older than the freshness bound) resolves to false', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const maxStalenessMs = 24 * 60 * 60 * 1000;
  await repository.upsert({ deviceId: DEVICE, familyId: FAMILY, protectionLevel: 'PROTECTED', updatedAt: new Date(NOW.getTime() - maxStalenessMs - 1000) });
  const resolver = new RealProtectiveAuthorityResolver(repository, { now: () => NOW, maxStalenessMs });
  assert.equal(await resolver.resolve(FAMILY, DEVICE), false);
});

test('a report exactly at the freshness boundary still resolves to true (inclusive bound)', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  const maxStalenessMs = 24 * 60 * 60 * 1000;
  await repository.upsert({ deviceId: DEVICE, familyId: FAMILY, protectionLevel: 'PROTECTED', updatedAt: new Date(NOW.getTime() - maxStalenessMs) });
  const resolver = new RealProtectiveAuthorityResolver(repository, { now: () => NOW, maxStalenessMs });
  assert.equal(await resolver.resolve(FAMILY, DEVICE), true);
});

test('a report for a different device in the same family never resolves for this device', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  await repository.upsert({ deviceId: 'device-pa-other', familyId: FAMILY, protectionLevel: 'PROTECTED', updatedAt: new Date(NOW.getTime() - 60_000) });
  const resolver = new RealProtectiveAuthorityResolver(repository, { now: () => NOW });
  assert.equal(await resolver.resolve(FAMILY, DEVICE), false);
});

test('a report for the same device id under a DIFFERENT family never resolves true for this family (cross-family IDOR)', async () => {
  const repository = new InMemoryDeviceProtectionStatusRepository();
  await repository.upsert({ deviceId: DEVICE, familyId: 'family-other', protectionLevel: 'PROTECTED', updatedAt: new Date(NOW.getTime() - 60_000) });
  const resolver = new RealProtectiveAuthorityResolver(repository, { now: () => NOW });
  assert.equal(await resolver.resolve(FAMILY, DEVICE), false);
});
