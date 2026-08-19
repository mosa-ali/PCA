import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMINISTRATION_PIN_MIN_LENGTH,
  AdministrationPinError,
  AdministrationPinService,
  InMemoryAdministrationPinRepository,
} from '../../dist/enrollment/AdministrationPinService.js';

function buildService() {
  let nowMs = Date.parse('2026-08-18T12:00:00.000Z');
  const delays = [];
  const repository = new InMemoryAdministrationPinRepository();
  const service = new AdministrationPinService({
    repository,
    now: () => new Date(nowMs),
    sleep: async (milliseconds) => delays.push(milliseconds),
  });
  return {
    service,
    repository,
    delays,
    advance: (milliseconds) => { nowMs += milliseconds; },
  };
}

test('configuration stores a salted memory-hard verifier and exposes the offline fallback role only', async () => {
  const { service, repository } = buildService();
  const first = await service.configurePin('family-pin-84', '123456');
  assert.deepEqual(first, {
    configured: true,
    minimumRecommendedLength: ADMINISTRATION_PIN_MIN_LENGTH,
    offlineFallbackRole: 'LOCAL_ADMINISTRATION_AUTHORIZATION',
    lockedUntilUtc: null,
  });

  const record = await repository.get('family-pin-84');
  assert.ok(record);
  assert.equal('pin' in record, false);
  assert.equal('rawPin' in record, false);
  assert.notEqual(record.saltB64, record.verifierB64);

  await service.configurePin('family-pin-84', '123456');
  const replaced = await repository.get('family-pin-84');
  assert.ok(replaced);
  assert.notEqual(replaced.saltB64, record.saltB64, 'reconfiguration must use a fresh salt');
});

test('weak or non-numeric PINs are rejected before a credential record is written', async () => {
  const { service, repository } = buildService();
  for (const pin of ['12345', '12ab56', '1'.repeat(65)]) {
    await assert.rejects(() => service.configurePin('family-pin-84', pin), AdministrationPinError);
  }
  assert.equal(await repository.get('family-pin-84'), null);
});

test('wrong PINs receive progressive delay and lockout, and a correct PIN is blocked until lockout expires', async () => {
  const { service, delays, advance } = buildService();
  await service.configurePin('family-pin-84', '123456');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await service.verifyPin('family-pin-84', '000000');
    assert.equal(result.ok, false);
    if (attempt < 4) assert.equal(result.code, 'INVALID_PIN');
    else assert.equal(result.code, 'RATE_LIMITED');
  }
  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000]);

  const locked = await service.verifyPin('family-pin-84', '123456');
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'RATE_LIMITED');

  advance(30_000);
  const accepted = await service.verifyPin('family-pin-84', '123456');
  assert.deepEqual(accepted, { ok: true });
  assert.equal((await service.getStatus('family-pin-84')).lockedUntilUtc, null);
});

test('an unconfigured family does not accept a local PIN authorization', async () => {
  const { service } = buildService();
  assert.deepEqual(await service.verifyPin('family-pin-84', '123456'), {
    ok: false,
    code: 'NOT_CONFIGURED',
    retryAfterMs: 0,
  });
});
