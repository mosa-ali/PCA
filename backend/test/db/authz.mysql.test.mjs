import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthzService, AuthzError } from '../../dist/authz/AuthzService.js';
import { MySqlAuthzRepository } from '../../dist/authz/MySqlAuthzRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlAuthzRepository();

function buildService(now = () => new Date()) {
  return new AuthzService(repository, now);
}

async function createAccount() {
  const accountId = randomUUID();
  await getPool().query(
    `INSERT INTO service_accounts (account_id, account_reference_hash, created_at, disabled_at) VALUES (?, ?, NOW(3), NULL)`,
    [accountId, Buffer.from(randomUUID())],
  );
  return accountId;
}

async function grantScope(accountId, familyId, status = 'ACTIVE') {
  await getPool().query(
    `INSERT INTO service_account_family_scopes (account_id, family_id, status, created_at) VALUES (?, ?, ?, NOW(3))`,
    [accountId, familyId, status],
  );
}

async function addLicense(accountId, status, expiresAt = null) {
  await getPool().query(
    `INSERT INTO licenses (license_id, account_id, license_reference_hash, status, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), accountId, Buffer.from(randomUUID()), status, expiresAt],
  );
}

function family() {
  return `family-${randomUUID()}`;
}

test('MySQL: correct account/scope succeeds', async () => {
  const service = buildService();
  const accountId = await createAccount();
  const familyId = family();
  await grantScope(accountId, familyId);
  await assert.doesNotReject(() => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId }));
});

test('MySQL: wrong account fails', async () => {
  const service = buildService();
  const familyId = family();
  await grantScope(await createAccount(), familyId);
  const otherAccount = await createAccount();
  await assert.rejects(() => service.authorize({ accountId: otherAccount, operation: 'VIEW_INVITATION_STATUS', familyId }), AuthzError);
});

test('MySQL: wrong family fails (IDOR check against real MySQL)', async () => {
  const service = buildService();
  const accountId = await createAccount();
  await grantScope(accountId, family());
  await assert.rejects(() => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId: family() }));
});

test('MySQL: revoked scope fails', async () => {
  const service = buildService();
  const accountId = await createAccount();
  const familyId = family();
  await grantScope(accountId, familyId, 'REVOKED');
  await assert.rejects(() => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId }));
});

test('MySQL: inactive (expired) license blocks a license-required operation', async () => {
  const service = buildService();
  const accountId = await createAccount();
  const familyId = family();
  await grantScope(accountId, familyId);
  await addLicense(accountId, 'ACTIVE', new Date(Date.now() - 60_000));
  await assert.rejects(() => service.authorize({ accountId, operation: 'CREATE_INVITATION', familyId }));
});

test('MySQL: active license + scope succeeds for a license-required operation', async () => {
  const service = buildService();
  const accountId = await createAccount();
  const familyId = family();
  await grantScope(accountId, familyId);
  await addLicense(accountId, 'ACTIVE', new Date(Date.now() + 60 * 60 * 1000));
  await assert.doesNotReject(() => service.authorize({ accountId, operation: 'CREATE_INVITATION', familyId }));
});

test('MySQL: family enumeration resistance -- nonexistent family fails identically to a revoked scope', async () => {
  const service = buildService();
  const accountId = await createAccount();
  const familyId = family();
  await grantScope(accountId, familyId, 'REVOKED');
  const revokedError = await service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId }).catch((e) => e);
  const unknownError = await service
    .authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId: family() })
    .catch((e) => e);
  assert.equal(revokedError.message, unknownError.message);
});

test('MySQL: direct repository abuse -- querying scope status for an unrelated account/family pair returns null, not another account\'s scope', async () => {
  const accountA = await createAccount();
  const accountB = await createAccount();
  const familyId = family();
  await grantScope(accountA, familyId);
  const statusForB = await repository.findFamilyScopeStatus(accountB, familyId);
  assert.equal(statusForB, null);
});

test('MySQL CONCURRENCY: a revoke-in-flight batch never crashes and never throws anything but AuthzError', async () => {
  // Weaker sanity check only -- does not bound the race window itself (a
  // request racing the UPDATE may legitimately read either pre- or
  // post-revoke committed state). The strong, unambiguous proof of "no
  // lingering-authorized window" is the next test, which revokes and
  // AWAITS the commit first.
  const service = buildService();
  const accountId = await createAccount();
  const familyId = family();
  await grantScope(accountId, familyId);

  const [, ...results] = await Promise.allSettled([
    getPool().query(`UPDATE service_account_family_scopes SET status = 'REVOKED' WHERE account_id = ? AND family_id = ?`, [accountId, familyId]),
    ...Array.from({ length: 10 }, () => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId })),
  ]);
  for (const outcome of results) {
    if (outcome.status === 'rejected') assert.ok(outcome.reason instanceof AuthzError);
  }
});

test('MySQL CONCURRENCY: once a revocation is committed, NO subsequently-issued concurrent authorize() call ever succeeds -- no lingering-authorized window', async () => {
  const service = buildService();
  const accountId = await createAccount();
  const familyId = family();
  await grantScope(accountId, familyId);
  await assert.doesNotReject(() => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId }));

  // Revoke and wait for the commit to be visible before firing anything else.
  await getPool().query(`UPDATE service_account_family_scopes SET status = 'REVOKED' WHERE account_id = ? AND family_id = ?`, [
    accountId,
    familyId,
  ]);

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId })),
  );
  assert.equal(results.every((r) => r.status === 'rejected'), true, 'every concurrent call issued after the commit must be rejected -- zero lingering grants');
  for (const outcome of results) assert.ok(outcome.reason instanceof AuthzError);
});

test.after(async () => {
  await closePool();
});
