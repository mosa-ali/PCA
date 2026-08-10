import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { PostgresInvitationRepository } from '../../dist/invitation/PostgresInvitationRepository.js';
import { hashInvitationToken } from '../../dist/invitation/token.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new PostgresInvitationRepository();

function buildService(now = () => new Date()) {
  return new InvitationService(repository, now);
}

const baseInput = {
  familyId: `family-${randomUUID()}`,
  platform: 'ANDROID',
  requestedProtectionMode: 'ANDROID_STANDARD',
};

test('PG: create/redeem lifecycle persists through real PostgreSQL', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  assert.equal(record.status, 'CREATED');
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');
});

test('PG: token hash uniqueness is DB-enforced (duplicate hash rejected by the database itself)', async () => {
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
  await assert.rejects(() => repository.create(second), (error) => error.code === '23505');
});

test('PG: second redemption rejected after real commit', async () => {
  const service = buildService();
  const { rawToken } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  await service.redeemInvitation(rawToken);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'ALREADY_REDEEMED' });
});

test('PG: expired invitation cannot be redeemed', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const service = buildService(() => now);
  const { rawToken } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}`, ttlMs: 60_000 });
  now = new Date(now.getTime() + 60_001);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'EXPIRED' });
});

test('PG: revoked invitation cannot be redeemed', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  await service.revokeInvitation(record.invitationId);
  await assert.rejects(() => service.redeemInvitation(rawToken), { code: 'REVOKED' });
});

test('PG CRITICAL CONCURRENCY: many simultaneous redemption attempts against one invitation -- exactly 1 succeeds', async () => {
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

test.after(async () => {
  await closePool();
});
