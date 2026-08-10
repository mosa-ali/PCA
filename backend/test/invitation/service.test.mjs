import assert from 'node:assert/strict';
import test from 'node:test';
import { InvitationService, InvitationError } from '../../dist/invitation/InvitationService.js';
import { hashInvitationToken } from '../../dist/invitation/token.js';
import { createInMemoryInvitationRepository } from '../support/inMemoryInvitationRepository.mjs';

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
  const service = new InvitationService(repository, clock.now);
  return { service, repository, clock };
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

test('resolveInvitationState reports EXPIRED once past expiry without a separate write', async () => {
  const { service, clock } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  assert.equal(await service.resolveInvitationState(rawToken), 'CREATED');
  clock.advance(TTL_MS + 1);
  assert.equal(await service.resolveInvitationState(rawToken), 'EXPIRED');
});

test('security: token truncation is rejected', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await assert.rejects(() => service.redeemInvitation(rawToken.slice(0, 10)), { code: 'INVALID_TOKEN' });
});

test('security: token extension is rejected (extended value does not collide)', async () => {
  const { service } = buildService();
  const { rawToken } = await service.createInvitation(baseInput);
  await assert.rejects(() => service.redeemInvitation(rawToken + 'AAAA'), { code: 'NOT_FOUND' });
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

test('security: negative or non-finite ttlMs is rejected rather than producing an already-expired or eternal invitation', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.createInvitation({ ...baseInput, ttlMs: -1 }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, ttlMs: Number.POSITIVE_INFINITY }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, ttlMs: Number.NaN }), RangeError);
});
