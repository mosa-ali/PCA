import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { MySqlInvitationRepository } from '../../dist/invitation/MySqlInvitationRepository.js';
import { hashInvitationToken } from '../../dist/invitation/token.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlInvitationRepository();

function buildService(now = () => new Date()) {
  return new InvitationService(repository, now);
}

const baseInput = {
  familyId: `family-${randomUUID()}`,
  platform: 'ANDROID',
  requestedProtectionMode: 'ANDROID_STANDARD',
};

test('MySQL: create/redeem lifecycle persists through real MySQL', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  assert.equal(record.status, 'CREATED');
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');
});

test('MySQL: token hash uniqueness is DB-enforced (duplicate hash rejected by the database itself)', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const first = {
    invitationId: randomUUID(),
    familyId: `family-${randomUUID()}`,
    tokenHash: 'a'.repeat(64),
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
    status: 'CREATED',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    openedAt: null,
    redeemedAt: null,
    revokedAt: null,
  };
  await repository.create(first);
  const second = { ...first, invitationId: randomUUID(), familyId: `family-${randomUUID()}` };
  await assert.rejects(() => repository.create(second), (error) => error.code === 'ER_DUP_ENTRY');
});

test('MySQL: second redemption rejected after real commit', async () => {
  const service = buildService();
  const { rawToken } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  await service.redeemInvitation(rawToken);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'ALREADY_REDEEMED' });
});

test('MySQL: expired invitation cannot be redeemed', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const service = buildService(() => now);
  const { rawToken } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}`, ttlMs: 60_000 });
  now = new Date(now.getTime() + 60_001);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'EXPIRED' });
});

test('MySQL: revoked invitation cannot be redeemed', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  await service.revokeInvitation(record.invitationId);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'REVOKED' });
});

test('MySQL CRITICAL CONCURRENCY: many simultaneous redemption attempts against one invitation -- exactly 1 succeeds', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });

  const attempts = await Promise.allSettled(
    Array.from({ length: 30 }, () => service.redeemInvitation(rawToken)),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent redemption must succeed');
  assert.equal(rejected.length, 29, 'all others must fail safely');
  for (const failure of rejected) assert.equal(failure.reason.code, 'ALREADY_REDEEMED');

  const final = await repository.findByTokenHash(hashInvitationToken(rawToken));
  assert.equal(final.status, 'REDEEMED', 'final persisted state must be REDEEMED, no duplicate enrollment state');
});

test('MySQL: REDEEMED is permanently terminal -- create -> redeem -> revoke -> fetch still reports REDEEMED', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  await service.redeemInvitation(rawToken);
  const afterRevoke = await service.revokeInvitation(record.invitationId);
  assert.equal(afterRevoke.status, 'REDEEMED');
  const fetched = await repository.findByTokenHash(hashInvitationToken(rawToken));
  assert.equal(fetched.status, 'REDEEMED');
  assert.equal(fetched.revokedAt, null);
});

test('MySQL CONCURRENCY: redeem raced against revoke resolves to exactly one deterministic, architecture-consistent terminal state', async () => {
  for (let trial = 0; trial < 15; trial++) {
    const service = buildService();
    const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });

    const [redeemOutcome] = await Promise.allSettled([
      service.redeemInvitation(rawToken),
      service.revokeInvitation(record.invitationId),
    ]);

    const final = await repository.findByTokenHash(hashInvitationToken(rawToken));
    assert.ok(['REDEEMED', 'REVOKED'].includes(final.status), `unexpected terminal state: ${final.status}`);

    if (final.status === 'REDEEMED') {
      assert.notEqual(final.redeemedAt, null);
      assert.equal(final.revokedAt, null, 'a REDEEMED invitation must never carry a revokedAt from a losing concurrent revoke');
      assert.equal(redeemOutcome.status, 'fulfilled', 'redeem must have been the winner if the final state is REDEEMED');
    } else {
      assert.notEqual(final.revokedAt, null);
      assert.equal(final.redeemedAt, null, 'a REVOKED invitation must never carry a redeemedAt from a losing concurrent redeem');
    }
  }
});

test.after(async () => {
  await closePool();
});
