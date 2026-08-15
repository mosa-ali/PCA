import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { MySqlInvitationRepository } from '../../dist/invitation/MySqlInvitationRepository.js';
import { hashInvitationToken } from '../../dist/invitation/token.js';
import { closePool, getPool } from '../../dist/db/pool.js';

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

// --- PCA-ADD-ENR-005/023: 8-state lifecycle against real MySQL ---------

test('MySQL: full forward lifecycle persists every intermediate timestamp and an immutable transition audit trail', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });

  await service.markOpened(rawToken);
  const installRequired = await service.markInstallRequired(rawToken);
  assert.equal(installRequired.status, 'INSTALL_REQUIRED');
  assert.ok(installRequired.installRequiredAt);

  const appInstalled = await service.markAppInstalled(rawToken);
  assert.equal(appInstalled.status, 'APP_INSTALLED');
  assert.ok(appInstalled.appInstalledAt);

  const authRequired = await service.markAuthorizationRequired(rawToken);
  assert.equal(authRequired.status, 'AUTHORIZATION_REQUIRED');
  assert.ok(authRequired.authorizationRequiredAt);

  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT from_status, to_status FROM enrollment_invitation_transitions WHERE invitation_id = ? ORDER BY transitioned_at ASC`,
    [record.invitationId],
  );
  assert.deepEqual(
    rows.map((r) => `${r.from_status}->${r.to_status}`),
    ['CREATED->OPENED', 'OPENED->INSTALL_REQUIRED', 'INSTALL_REQUIRED->APP_INSTALLED', 'APP_INSTALLED->AUTHORIZATION_REQUIRED', 'AUTHORIZATION_REQUIRED->REDEEMED'],
  );
});

test('MySQL: redemption remains reachable directly from CREATED, skipping every intermediate state (existing bootstrap flow unbroken)', async () => {
  const service = buildService();
  const { rawToken } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  const redeemed = await service.redeemInvitation(rawToken);
  assert.equal(redeemed.status, 'REDEEMED');
});

test('MySQL: EXPIRED is a real committed row, not just a value returned to the caller', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const service = buildService(() => now);
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}`, ttlMs: 60_000 });
  now = new Date(now.getTime() + 60_001);
  assert.equal(await service.resolveInvitationState(rawToken), 'EXPIRED');

  const stored = await repository.findByTokenHash(hashInvitationToken(rawToken));
  assert.equal(stored.status, 'EXPIRED');
  assert.notEqual(stored.expiredAt, null);

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT from_status, to_status FROM enrollment_invitation_transitions WHERE invitation_id = ? AND to_status = 'EXPIRED'`,
    [record.invitationId],
  );
  assert.equal(rows.length, 1, 'exactly one EXPIRED transition row, committed to real MySQL');
});

test('MySQL: out-of-order (backward) lifecycle transition is rejected without corrupting the persisted forward state', async () => {
  const service = buildService();
  const { rawToken } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  await service.markAuthorizationRequired(rawToken);
  await assert.rejects(() => service.markInstallRequired(rawToken), { code: 'INVALID_STATE' });
  assert.equal(await service.resolveInvitationState(rawToken), 'AUTHORIZATION_REQUIRED');
});

test('MySQL: revoked invitation rejects every lifecycle-progress transition', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });
  await service.revokeInvitation(record.invitationId);
  await assert.rejects(() => service.markInstallRequired(rawToken), { code: 'REVOKED' });
  await assert.rejects(() => service.markAppInstalled(rawToken), { code: 'REVOKED' });
  await assert.rejects(() => service.markAuthorizationRequired(rawToken), { code: 'REVOKED' });
});

test('MySQL CRITICAL CONCURRENCY: many simultaneous markInstallRequired calls against one invitation -- exactly 1 real transition row is written', async () => {
  const service = buildService();
  const { rawToken, record } = await service.createInvitation({ ...baseInput, familyId: `family-${randomUUID()}` });

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.markInstallRequired(rawToken)),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  // Idempotent: every attempt succeeds (ALREADY_IN_STATE collapses into the
  // same success as TRANSITIONED at the service layer), but exactly one
  // underlying transition row is ever committed.
  assert.equal(fulfilled.length, 20);

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM enrollment_invitation_transitions WHERE invitation_id = ? AND to_status = 'INSTALL_REQUIRED'`,
    [record.invitationId],
  );
  assert.equal(rows[0].n, 1, 'exactly one INSTALL_REQUIRED transition row despite 20 concurrent callers');
});

test.after(async () => {
  await closePool();
});
