import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { BrowserEndpointService, BrowserEndpointError } from '../../dist/device/BrowserEndpointService.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';

function key() {
  return randomBytes(32).toString('base64url');
}

const FAMILY = 'family-browser-1';

async function confirmCurrent(pairingService, deviceId, accountId) {
  const view = await pairingService.getPairingRequest(FAMILY, deviceId);
  return pairingService.confirmPairing(FAMILY, deviceId, accountId, {
    expectedDskFingerprint: view.dskFingerprint,
    expectedDekFingerprint: view.dekFingerprint,
  });
}

function buildService() {
  const repository = createInMemoryDeviceRepository();
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const service = new BrowserEndpointService(repository, now);
  const pairingService = new PairingService(repository, now);
  return { service, repository, pairingService };
}

test('registerEndpoint creates a PAIRING_PENDING BROWSER device with a single ACTIVE DSK, never a DEK', async () => {
  const { service, repository } = buildService();
  const registeredBy = randomUUID();
  const result = await service.registerEndpoint(FAMILY, registeredBy, key());
  assert.equal(result.status, 'PAIRING_PENDING');
  assert.ok(result.deviceId);

  const device = await repository.findDeviceForFamily(FAMILY, result.deviceId);
  assert.equal(device.platform, 'BROWSER');
  assert.equal(device.status, 'PAIRING_PENDING');
  assert.equal(device.registeredByAccountId, registeredBy);
  assert.equal(device.pairedByAccountId, null, 'registration alone must never itself confirm pairing');

  const keys = await repository.findKeysByDeviceForFamily(FAMILY, result.deviceId);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].keyPurpose, 'DSK');
  assert.equal(keys[0].status, 'ACTIVE');
});

test('registerEndpoint rejects a malformed public key, never creates a device', async () => {
  const { service, repository } = buildService();
  await assert.rejects(
    () => service.registerEndpoint(FAMILY, randomUUID(), 'not a real key'),
    { code: 'INVALID_PUBLIC_KEY' },
  );
  await assert.rejects(() => service.registerEndpoint(FAMILY, randomUUID(), ''), { code: 'INVALID_PUBLIC_KEY' });
});

test('registerEndpoint rejects an invalid or out-of-range persistence clock before repository effects', async () => {
  let repositoryCalls = 0;
  const repository = {
    async createDeviceWithKey() {
      repositoryCalls += 1;
      return { outcome: 'CREATED' };
    },
  };
  for (const clockValue of [
    new Date(Number.NaN),
    new Date('0999-12-31T23:59:59.999Z'),
    new Date('10000-01-01T00:00:00.000Z'),
    '2026-01-01T00:00:00.000Z',
  ]) {
    const service = new BrowserEndpointService(repository, () => clockValue);
    await assert.rejects(
      () => service.registerEndpoint(FAMILY, randomUUID(), key()),
      (error) => error instanceof TypeError && error.message === 'Device directory clock must return a valid persistence timestamp.',
    );
  }
  assert.equal(repositoryCalls, 0, 'invalid timestamps must be rejected before persistence is invoked');
});

test('registerEndpoint accepts MySQL DATETIME year boundaries', async () => {
  for (const timestamp of [new Date('1000-01-01T00:00:00.000Z'), new Date('9999-12-31T23:59:59.999Z')]) {
    const repository = createInMemoryDeviceRepository();
    const service = new BrowserEndpointService(repository, () => timestamp);
    const result = await service.registerEndpoint(FAMILY, randomUUID(), key());
    const device = await repository.findDeviceForFamily(FAMILY, result.deviceId);
    const [registeredKey] = await repository.findKeysByDeviceForFamily(FAMILY, result.deviceId);
    assert.equal(device.createdAt.getTime(), timestamp.getTime());
    assert.equal(registeredKey.createdAt.getTime(), timestamp.getTime());
  }
});

test('registerEndpoint rejects a public key already registered to another device', async () => {
  const { service } = buildService();
  const sharedKey = key();
  await service.registerEndpoint(FAMILY, randomUUID(), sharedKey);
  await assert.rejects(
    () => service.registerEndpoint(FAMILY, randomUUID(), sharedKey),
    { code: 'DUPLICATE_KEY' },
  );
});

test('Parent-session browser registration does not misattribute the account id as a device actor', async () => {
  const repository = createInMemoryDeviceRepository();
  let recordedEvent = null;
  const service = new BrowserEndpointService(repository, () => new Date('2026-01-01T00:00:00.000Z'), {
    async record(event) { recordedEvent = event; },
  });
  const registeredByAccountId = randomUUID();

  const result = await service.registerEndpoint(FAMILY, registeredByAccountId, key());

  assert.equal(result.status, 'PAIRING_PENDING');
  assert.equal(recordedEvent.actorDeviceId, 'SERVICE_SESSION');
  assert.notEqual(recordedEvent.actorDeviceId, registeredByAccountId);
  assert.equal(recordedEvent.targetScope.id, result.deviceId);
});

test('committed browser registration returns its device id when the one-shot audit append fails', async () => {
  const repository = createInMemoryDeviceRepository();
  let auditAttempts = 0;
  const service = new BrowserEndpointService(repository, () => new Date('2026-01-01T00:00:00.000Z'), {
    async record() {
      auditAttempts += 1;
      throw new Error('private audit storage failure');
    },
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const registeredBy = randomUUID();
    const publicKey = key();
    const result = await service.registerEndpoint(FAMILY, registeredBy, publicKey);
    assert.equal(result.status, 'PAIRING_PENDING');
    const device = await repository.findDeviceForFamily(FAMILY, result.deviceId);
    assert.equal(device.status, 'PAIRING_PENDING');
    assert.equal(device.registeredByAccountId, registeredBy);
    assert.equal((await repository.findKeysByDeviceForFamily(FAMILY, result.deviceId)).length, 1);
    await assert.rejects(() => service.registerEndpoint(FAMILY, registeredBy, publicKey), { code: 'DUPLICATE_KEY' });
    assert.equal(auditAttempts, 1, 'the original committed device remains discoverable from its returned id');
    assert.equal(warnings.length, 1);
    assert.deepEqual(JSON.parse(warnings[0]), {
      event: 'browser_endpoint_registration_audit_append_failed',
      occurrences: 1,
    });
    assert.equal(warnings[0].includes('private audit storage failure'), false);
  } finally {
    console.warn = originalWarn;
  }
});

test('two different families can register browser endpoints independently, with independent deviceIds', async () => {
  const { service } = buildService();
  const a = await service.registerEndpoint('family-a', randomUUID(), key());
  const b = await service.registerEndpoint('family-b', randomUUID(), key());
  assert.notEqual(a.deviceId, b.deviceId);
});

test('end-to-end: registration -> confirm by a DIFFERENT account reaches PAIRED; the SAME account is denied', async () => {
  const { service, pairingService } = buildService();
  const registeredBy = randomUUID();
  const { deviceId } = await service.registerEndpoint(FAMILY, registeredBy, key());

  await assert.rejects(
    () => confirmCurrent(pairingService, deviceId, registeredBy),
    { code: 'SELF_APPROVAL_DENIED' },
  );

  const view = await confirmCurrent(pairingService, deviceId, randomUUID());
  assert.equal(view.status, 'PAIRED');
});
