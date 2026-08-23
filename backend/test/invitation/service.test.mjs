import assert from 'node:assert/strict';
import test from 'node:test';
import { InvitationService, InvitationError } from '../../dist/invitation/InvitationService.js';
import { SlotReservationService, SlotReservationError } from '../../dist/entitlements/slots/SlotReservationService.js';
import { hashInvitationToken } from '../../dist/invitation/token.js';
import { DEFAULT_INVITATION_TTL_MS, MAX_INVITATION_TTL_MS } from '../../dist/invitation/policy.js';
import { createInMemoryInvitationRepository } from '../support/inMemoryInvitationRepository.mjs';
import { ProtectionAlertProducer } from '../../dist/alerts/ProtectionAlertProducer.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

function buildService(overrides = {}) {
  const repository = overrides.repository ?? createInMemoryInvitationRepository();
  let currentTime = overrides.startTime ?? BASE_TIME;
  const clock = {
    now: () => new Date(currentTime),
    advance: (ms) => { currentTime += ms; },
    set: (ms) => { currentTime = ms; },
  };
  const service = new InvitationService(repository, clock.now, undefined, undefined, overrides.alerting ?? null);
  return { service, repository, clock };
}

function makeAlerting({ enabled = true } = {}) {
  const ledger = new InMemoryProtectionAlertLedger();
  const producer = new ProtectionAlertProducer(
    ledger,
    async () => ({ encryptedPayloadB64: 'AQID', nonceB64: 'BAUG' }),
    () => new Date(BASE_TIME),
  );
  return {
    alerting: {
      producer,
      alertsEnabled: enabled,
      async resolveParentDevices() {
        return [{ deviceId: 'parent-device-1', keyEpoch: 3 }];
      },
    },
    ledger,
  };
}

const baseInput = {
  familyId: 'family-opaque-1',
  platform: 'ANDROID',
  requestedProtectionMode: 'ANDROID_STANDARD',
  ttlMs: TTL_MS,
};

test('create = CREATED', async () => {
  const { service } = buildService();
  const { record } = await service.createInvitation(baseInput);
  assert.equal(record.status, 'CREATED');
  assert.equal(record.familyId, baseInput.familyId);
  assert.equal(record.redeemedAt, null);
});

test('open transition valid: CREATED -> OPENED', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  const opened = await service.markOpened(rawToken);
  assert.equal(opened.status, 'OPENED');
  assert.notEqual(opened.openedAt, null);
});

test('redeem valid once', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');
  assert.notEqual(redeemed.redeemedAt, null);
});

test('second redemption rejected', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await service.redeemInvitation(rawToken);
  await assert.rejects(() => service.redeemInvitation(rawToken), (error) => {
    assert.ok(error instanceof InvitationError);
    assert.equal(error.code, 'ALREADY_REDEEMED');
    return true;
  });
});

test('revoked token rejected', async () => {
  const { service } = buildService();
  const { record, rawToken } = await service.createInvitation(baseInput);
  await service.revokeInvitation(record.invitationId);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'REVOKED' });
});

test('expired token rejected', async () => {
  const { service, clock } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  clock.advance(TTL_MS + 1);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'EXPIRED' });
});

test('invalid (unknown but well-formed) token rejected', async () => {
  const { service } = buildService();
  const fakeToken = 'A'.repeat(43);
  await assert.rejects(() => service.redeemInvitation(fakeToken), { code: 'NOT_FOUND' });
});

test('malformed token rejected before any repository lookup', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.redeemInvitation('not a valid token'), { code: 'INVALID_TOKEN' });
  await assert.rejects(() => service.redeemInvitation(''), { code: 'INVALID_TOKEN' });
});

test('exact expiration boundary rejected (redemption at expiresAt instant fails)', async () => {
  const { service, repository, clock } = buildService();
  const { rawToken, record } = await service.createInvitation(baseInput);
  clock.set(record.expiresAt.getTime());
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'EXPIRED' });
  const stored = await repository.findByTokenHash(hashInvitationToken(rawToken));
  assert.notEqual(stored.status, 'REDEEMED');
});

test('state cannot move from REDEEMED to active (open after redeem is a no-op returning REDEEMED)', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await service.redeemInvitation(rawToken);
  await assert.rejects(() => service.markOpened(rawToken), { code: 'ALREADY_REDEEMED' });
});

test('state cannot move from REVOKED to active', async () => {
  const { service } = buildService();
  const { record, rawToken } = await service.createInvitation(baseInput);
  await service.revokeInvitation(record.invitationId);
  await assert.rejects(() => service.markOpened(rawToken), { code: 'REVOKED' });
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'REVOKED' });
});

test('REDEEMED is permanently terminal: revoking an already-redeemed invitation does not change its status', async () => {
  const { service, repository } = buildService();
  const { record, rawToken } = await service.createInvitation(baseInput);
  const redeemed = await service.redeemInvitation(rawToken);
  const afterRevoke = await service.revokeInvitation(record.invitationId);
  assert.equal(afterRevoke.status, 'REDEEMED');
  assert.equal(afterRevoke.redeemedAt.getTime(), redeemed.redeemedAt.getTime());
  assert.equal(afterRevoke.revokedAt, null);
  const stored = await repository.findByTokenHash(hashInvitationToken(rawToken));
  assert.equal(stored.status, 'REDEEMED');
});

test('REVOKED revocation timestamp is idempotent: revoking twice preserves the first revocation instant', async () => {
  const { service, clock } = buildService();
  const { record } = await service.createInvitation(baseInput);
  const first = await service.revokeInvitation(record.invitationId);
  clock.advance(60_000);
  const second = await service.revokeInvitation(record.invitationId);
  assert.equal(second.revokedAt.getTime(), first.revokedAt.getTime());
});

test('raw secret absent from thrown errors', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await service.redeemInvitation(rawToken);
  try {
    await service.redeemInvitation(rawToken);
    assert.fail('expected rejection');
  } catch (error) {
    assert.equal(String(error.message).includes(rawToken), false);
    assert.equal(JSON.stringify(error).includes(rawToken), false);
  }
});

test('raw secret absent from record serialization (record only ever carries tokenHash)', async () => {
  const { service } = buildService();
  const { record, rawToken } = await service.createInvitation(baseInput);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(rawToken), false);
  assert.equal(serialized.includes(record.tokenHash), true);
});

test('invitation redemption cannot authorize an unrelated family: familyId is server-controlled, not client-suppliable', async () => {
  const { service } = buildService();
  const { record, rawToken } = await service.createInvitation({ ...baseInput, familyId: 'family-A' });
  // redeemInvitation's signature accepts only the bearer token -- there is no
  // parameter through which a caller could assert a different family.
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.familyId, 'family-A');
  assert.equal(redeemed.familyId, record.familyId);
});

test('wrong-family context: two families produce independent, non-interchangeable invitations', async () => {
  const { service } = buildService();
  const a = await service.createInvitation({ ...baseInput, familyId: 'family-A' });
  const b = await service.createInvitation({ ...baseInput, familyId: 'family-B' });
  assert.notEqual(a.rawToken, b.rawToken);
  const redeemedA = await service.redeemInvitation(a.rawToken);
  assert.equal(redeemedA.familyId, 'family-A');
  await assert.rejects(() => service.redeemInvitation(a.rawToken), { code: 'ALREADY_REDEEMED' });
  // family-B invitation is untouched by family-A's redemption
  const stateB = await service.resolveInvitationState(b.rawToken);
  assert.equal(stateB, 'CREATED');
});

test('concurrent-redeem repository contract: exactly one of many simultaneous attempts succeeds', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  const attempts = await Promise.allSettled(
    Array.from({ length: 25 }, () => service.redeemInvitation(rawToken)),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 24);
  for (const failure of rejected) {
    assert.equal(failure.reason.code, 'ALREADY_REDEEMED');
  }
});

test('resolveInvitationState reports EXPIRED once past expiry, and PERSISTS a real audited EXPIRED transition (PCA-ADD-ENR-005)', async () => {
  const { service, repository, clock } = buildService();
  const { rawToken, record } = await service.createInvitation(baseInput);
  assert.equal(await service.resolveInvitationState(rawToken), 'CREATED');
  clock.advance(TTL_MS + 1);
  assert.equal(await service.resolveInvitationState(rawToken), 'EXPIRED');

  // Unlike the old computed-on-read behavior, EXPIRED is now a real write:
  // the underlying repository record itself is EXPIRED, not just the value
  // returned to this caller.
  const stored = await repository.findByTokenHash(hashInvitationToken(rawToken));
  assert.equal(stored.status, 'EXPIRED');
  assert.notEqual(stored.expiredAt, null);

  const transition = repository.transitions.find((t) => t.invitationId === record.invitationId && t.toStatus === 'EXPIRED');
  assert.ok(transition, 'an immutable EXPIRED transition audit row must exist');
  assert.equal(transition.fromStatus, 'CREATED');
});

test('security: token truncation is rejected', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await assert.rejects(() => service.redeemInvitation(rawToken.slice(0, 10)), { code: 'INVALID_TOKEN' });
});

test('security: token extension is rejected as malformed (canonical length no longer matches)', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await assert.rejects(() => service.redeemInvitation(rawToken + 'AAAA'), { code: 'INVALID_TOKEN' });
});

test('security: empty and oversized input rejected without throwing an unhandled error', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.redeemInvitation(''), { code: 'INVALID_TOKEN' });
  await assert.rejects(() => service.redeemInvitation('x'.repeat(10_000)), { code: 'INVALID_TOKEN' });
});

test('security: createInvitation ignores any attempt to pass a client-forged status/expiry/id (input type has no such fields)', async () => {
  const { service } = buildService();
  const forged = { ...baseInput, status: 'REDEEMED', expiresAt: new Date(0), invitationId: 'attacker-chosen' };
  const { record } = await service.createInvitation(forged);
  assert.equal(record.status, 'CREATED');
  assert.notEqual(record.invitationId, 'attacker-chosen');
  assert.equal(record.expiresAt.getTime() > BASE_TIME, true);
});

test('PCA-ADD-PA-027: an over-limit managed-device slot reservation surfaces as a caller-actionable MANAGED_DEVICE_LIMIT_REACHED code, not a raw SlotReservationError, and no invitation is persisted', async () => {
  const repository = createInMemoryInvitationRepository();
  const slotRepository = {
    findByInvitationId: async () => null,
    reserve: async () => ({ outcome: 'NO_AVAILABLE_SLOT' }),
  };
  const slotReservationService = new SlotReservationService(slotRepository, () => new Date(BASE_TIME));
  const service = new InvitationService(repository, () => new Date(BASE_TIME), undefined, slotReservationService);
  await assert.rejects(
    () => service.createInvitation(baseInput),
    (error) => error instanceof InvitationError && error.code === 'MANAGED_DEVICE_LIMIT_REACHED',
  );
  assert.deepEqual(await repository.listForFamily(baseInput.familyId), []);
});

test('PCA-ADD-PA-027: an entitlement-not-found slot reservation failure is also translated to MANAGED_DEVICE_LIMIT_REACHED (never an unmapped SlotReservationError)', async () => {
  const repository = createInMemoryInvitationRepository();
  const slotRepository = {
    findByInvitationId: async () => null,
    reserve: async () => ({ outcome: 'ENTITLEMENT_NOT_FOUND' }),
  };
  const slotReservationService = new SlotReservationService(slotRepository, () => new Date(BASE_TIME));
  const service = new InvitationService(repository, () => new Date(BASE_TIME), undefined, slotReservationService);
  await assert.rejects(
    () => service.createInvitation(baseInput),
    (error) => error instanceof InvitationError && !(error instanceof SlotReservationError) && error.code === 'MANAGED_DEVICE_LIMIT_REACHED',
  );
});

test('security: negative or non-finite ttlMs is rejected rather than producing an already-expired or eternal invitation', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.createInvitation({ ...baseInput, ttlMs: -1 }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, ttlMs: 0 }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, ttlMs: Number.POSITIVE_INFINITY }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, ttlMs: Number.NaN }), RangeError);
});

test('TTL policy: omitted ttlMs falls back to the server default', async () => {
  const { service } = buildService();
  const withoutTtl = { ...baseInput };
  delete withoutTtl.ttlMs;
  const { record } = await service.createInvitation(withoutTtl);
  assert.equal(record.expiresAt.getTime() - record.createdAt.getTime(), DEFAULT_INVITATION_TTL_MS);
});

test('TTL policy: exactly the server maximum is accepted', async () => {
  const { service } = buildService();
  const { record } = await service.createInvitation({ ...baseInput, ttlMs: MAX_INVITATION_TTL_MS });
  assert.equal(record.expiresAt.getTime() - record.createdAt.getTime(), MAX_INVITATION_TTL_MS);
});

test('TTL policy: one millisecond above the server maximum is rejected', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.createInvitation({ ...baseInput, ttlMs: MAX_INVITATION_TTL_MS + 1 }),
    RangeError,
  );
});

test('TTL policy: a shorter client-requested lifetime is honored exactly, not silently extended', async () => {
  const { service } = buildService();
  const shortTtl = 60_000;
  const { record } = await service.createInvitation({ ...baseInput, ttlMs: shortTtl });
  assert.equal(record.expiresAt.getTime() - record.createdAt.getTime(), shortTtl);
});

test('TTL policy: a caller cannot exceed the maximum by requesting an astronomically large ttlMs (overflow guard)', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.createInvitation({ ...baseInput, ttlMs: Number.MAX_SAFE_INTEGER }),
    RangeError,
  );
});

// -----------------------------------------------------------------------
// PCA-ADD-ENR-005 (Addendum 001): full 8-state invitation lifecycle --
// INSTALL_REQUIRED / APP_INSTALLED / AUTHORIZATION_REQUIRED as real,
// persisted, audited transitions.
// -----------------------------------------------------------------------

test('8-state lifecycle: full forward path CREATED -> OPENED -> INSTALL_REQUIRED -> APP_INSTALLED -> AUTHORIZATION_REQUIRED -> REDEEMED', async () => {
  const { service, repository } = buildService();
  const { rawToken, record } = await service.createInvitation(baseInput);

  await service.markOpened(rawToken);
  const installRequired = await service.markInstallRequired(rawToken);
  assert.equal(installRequired.status, 'INSTALL_REQUIRED');
  assert.notEqual(installRequired.installRequiredAt, null);

  const appInstalled = await service.markAppInstalled(rawToken);
  assert.equal(appInstalled.status, 'APP_INSTALLED');
  assert.notEqual(appInstalled.appInstalledAt, null);

  const authRequired = await service.markAuthorizationRequired(rawToken);
  assert.equal(authRequired.status, 'AUTHORIZATION_REQUIRED');
  assert.notEqual(authRequired.authorizationRequiredAt, null);

  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');

  const path = repository.transitions
    .filter((t) => t.invitationId === record.invitationId)
    .map((t) => `${t.fromStatus}->${t.toStatus}`);
  assert.deepEqual(path, [
    'CREATED->OPENED',
    'OPENED->INSTALL_REQUIRED',
    'INSTALL_REQUIRED->APP_INSTALLED',
    'APP_INSTALLED->AUTHORIZATION_REQUIRED',
    'AUTHORIZATION_REQUIRED->REDEEMED',
  ]);
});

test('8-state lifecycle: steps may be skipped -- APP_INSTALLED is reachable directly from CREATED', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  const appInstalled = await service.markAppInstalled(rawToken);
  assert.equal(appInstalled.status, 'APP_INSTALLED');
});

test('8-state lifecycle: redemption remains reachable directly from CREATED (existing direct-bootstrap flow is unbroken)', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');
});

test('8-state lifecycle: forward transition is idempotent -- calling markInstallRequired twice does not error', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  const first = await service.markInstallRequired(rawToken);
  const second = await service.markInstallRequired(rawToken);
  assert.equal(first.status, 'INSTALL_REQUIRED');
  assert.equal(second.status, 'INSTALL_REQUIRED');
  assert.equal(second.installRequiredAt.getTime(), first.installRequiredAt.getTime());
});

test('8-state lifecycle: out-of-order transition rejected (going backward after progressing forward)', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await service.markAuthorizationRequired(rawToken);
  await assert.rejects(() => service.markInstallRequired(rawToken), (error) => {
    assert.equal(error.code, 'INVALID_STATE');
    return true;
  });
});

test('8-state lifecycle: forward transitions rejected on a REVOKED invitation, without leaking beyond the generic REVOKED code', async () => {
  const { service } = buildService();
  const { record, rawToken } = await service.createInvitation(baseInput);
  await service.revokeInvitation(record.invitationId);
  await assert.rejects(() => service.markInstallRequired(rawToken), { code: 'REVOKED' });
  await assert.rejects(() => service.markAppInstalled(rawToken), { code: 'REVOKED' });
  await assert.rejects(() => service.markAuthorizationRequired(rawToken), { code: 'REVOKED' });
});

test('8-state lifecycle: forward transitions rejected on an already-REDEEMED invitation', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await service.redeemInvitation(rawToken);
  await assert.rejects(() => service.markInstallRequired(rawToken), { code: 'ALREADY_REDEEMED' });
});

test('8-state lifecycle: forward transitions rejected on an EXPIRED invitation, and expiry is persisted as a real transition first', async () => {
  const { service, repository, clock } = buildService();
  const { rawToken, record } = await service.createInvitation(baseInput);
  clock.advance(TTL_MS + 1);
  await assert.rejects(() => service.markInstallRequired(rawToken), { code: 'EXPIRED' });
  const stored = await repository.findByTokenHash(hashInvitationToken(rawToken));
  assert.equal(stored.status, 'EXPIRED');
  const transition = repository.transitions.find((t) => t.invitationId === record.invitationId && t.toStatus === 'EXPIRED');
  assert.ok(transition, 'expiry observed via a forward-transition call must still be persisted and audited');
});

test('8-state lifecycle: getInvitationForFamily persists EXPIRED as a real write, not just a computed read value', async () => {
  const { service, repository, clock } = buildService();
  const { record } = await service.createInvitation(baseInput);
  clock.advance(TTL_MS + 1);
  const fetched = await service.getInvitationForFamily(baseInput.familyId, record.invitationId);
  assert.equal(fetched.status, 'EXPIRED');
  const stored = await repository.findByIdForFamily(baseInput.familyId, record.invitationId);
  assert.equal(stored.status, 'EXPIRED');
});

test('8-state lifecycle: listInvitationsForFamily persists EXPIRED for every due record it observes', async () => {
  const { service, repository, clock } = buildService();
  const a = await service.createInvitation({ ...baseInput, familyId: 'family-list-expiry' });
  await service.createInvitation({ ...baseInput, familyId: 'family-list-expiry', ttlMs: TTL_MS * 4 });
  clock.advance(TTL_MS + 1);
  const list = await service.listInvitationsForFamily('family-list-expiry');
  const expiredOne = list.find((r) => r.invitationId === a.record.invitationId);
  assert.equal(expiredOne.status, 'EXPIRED');
  const stillActive = list.find((r) => r.invitationId !== a.record.invitationId);
  assert.equal(stillActive.status, 'CREATED');
});

test('8-state lifecycle: malformed/unknown token rejected identically for the new transitions as for redemption', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.markInstallRequired('not a valid token'), { code: 'INVALID_TOKEN' });
  await assert.rejects(() => service.markAppInstalled('A'.repeat(43)), { code: 'NOT_FOUND' });
});

// --- PCA-ADD-ENR-020 alert wiring ---

test('a successful redemption emits INVITATION_REDEEMED to every resolved parent device, with a null deviceId', async () => {
  const { alerting, ledger } = makeAlerting();
  const { service } = buildService({ alerting });
  const { rawToken, record } = await service.createInvitation(baseInput);
  await service.redeemInvitation(rawToken);
  const events = await ledger.listForFamily(record.familyId);
  assert.deepEqual(events.map((e) => e.trigger), ['INVITATION_REDEEMED']);
  assert.equal(events[0].deviceId, null);
  assert.equal(events[0].parentDeviceId, 'parent-device-1');
});

test('a failed redemption (already redeemed) never emits INVITATION_REDEEMED a second time', async () => {
  const { alerting, ledger } = makeAlerting();
  const { service } = buildService({ alerting });
  const { rawToken, record } = await service.createInvitation(baseInput);
  await service.redeemInvitation(rawToken);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'ALREADY_REDEEMED' });
  const events = await ledger.listForFamily(record.familyId);
  assert.equal(events.length, 1);
});

test('disabled alerting never invokes the composer and never blocks redemption', async () => {
  const { alerting, ledger } = makeAlerting({ enabled: false });
  const { service } = buildService({ alerting });
  const { rawToken, record } = await service.createInvitation(baseInput);
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');
  assert.deepEqual(await ledger.listForFamily(record.familyId), []);
});

test('an alert composer failure never blocks or reverses redemption', async () => {
  const ledger = new InMemoryProtectionAlertLedger();
  const producer = new ProtectionAlertProducer(ledger, async () => {
    throw new Error('composer unavailable');
  }, () => new Date(BASE_TIME));
  const alerting = {
    producer,
    alertsEnabled: true,
    async resolveParentDevices() {
      return [{ deviceId: 'parent-device-1', keyEpoch: 3 }];
    },
  };
  const { service } = buildService({ alerting });
  const { rawToken } = await service.createInvitation(baseInput);
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');
});
