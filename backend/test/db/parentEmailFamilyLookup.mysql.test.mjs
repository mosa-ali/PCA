import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { resolveParentEmailFamilyLookupOnConnection } from '../../dist/platformadmin/accounts/ParentEmailFamilyLookup.js';

function requireLoopbackTestDatabase() {
  const configured = process.env.PCA_DATABASE_URL;
  assert.ok(configured, 'PCA_DATABASE_URL is required');
  const url = new URL(configured);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(url.hostname), 'refusing to run against a non-loopback database');
  assert.equal(url.pathname.replace(/^\//, ''), 'pca_test', 'refusing to run against a database other than pca_test');
  return configured;
}

function hashForFixture() {
  return createHash('sha256').update(randomUUID(), 'utf8').digest();
}

async function insertVerifiedAccount(connection, { accountId = randomUUID(), emailHash = hashForFixture(), familyId = null } = {}) {
  await connection.execute(
    `INSERT INTO parent_accounts
       (account_id, email_hash, password_hash, status, family_id, free_access_mode,
        created_at, verified_at)
     VALUES (?, ?, 'fixture-password-hash', 'VERIFIED', ?, 'PERPETUAL', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [accountId, emailHash, familyId],
  );
  return { accountId, emailHash };
}

async function insertFamily(connection, { familyId = randomUUID(), provisionedForAccountId = null, status = 'ACTIVE' } = {}) {
  const familyReferenceHash = createHash('sha256').update(randomUUID(), 'utf8').digest();
  await connection.execute(
    `INSERT INTO families (family_id, family_reference_hash, created_at, status, provisioned_for_account_id)
     VALUES (?, ?, UTC_TIMESTAMP(3), ?, ?)`,
    [familyId, familyReferenceHash, status, provisionedForAccountId],
  );
  return familyId;
}

test('MySQL lookup follows only direct, provisioned, or active administrator family links', async () => {
  const connection = await mysql.createConnection(requireLoopbackTestDatabase());
  await connection.beginTransaction();
  try {
    const directFamilyId = await insertFamily(connection);
    const direct = await insertVerifiedAccount(connection, { familyId: directFamilyId });

    const provisioned = await insertVerifiedAccount(connection);
    const provisionedFamilyId = await insertFamily(connection, { provisionedForAccountId: provisioned.accountId });

    const membership = await insertVerifiedAccount(connection);
    const adminFamilyId = await insertFamily(connection);
    const viewerFamilyId = await insertFamily(connection);
    const revokedFamilyId = await insertFamily(connection);
    const unrelated = await insertVerifiedAccount(connection);
    const unrelatedAdminFamilyId = await insertFamily(connection);
    for (const [familyId, accountId, role, status] of [
      [adminFamilyId, membership.accountId, 'ADMINISTRATOR', 'ACTIVE'],
      [viewerFamilyId, membership.accountId, 'VIEWER', 'ACTIVE'],
      [revokedFamilyId, membership.accountId, 'ADMINISTRATOR', 'REVOKED'],
      [unrelatedAdminFamilyId, unrelated.accountId, 'ADMINISTRATOR', 'ACTIVE'],
    ]) {
      await connection.execute(
        `INSERT INTO family_parent_memberships
           (membership_id, family_id, account_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID(), familyId, accountId, role, status],
      );
    }

    const directResult = await resolveParentEmailFamilyLookupOnConnection(connection, direct.emailHash);
    assert.deepEqual(directResult, { outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: [directFamilyId] });

    const provisionedResult = await resolveParentEmailFamilyLookupOnConnection(connection, provisioned.emailHash);
    assert.deepEqual(provisionedResult, { outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: [provisionedFamilyId] });

    const membershipResult = await resolveParentEmailFamilyLookupOnConnection(connection, membership.emailHash);
    assert.deepEqual(membershipResult, { outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: [adminFamilyId] });
    assert.ok(!membershipResult.familyIds.includes(viewerFamilyId));
    assert.ok(!membershipResult.familyIds.includes(revokedFamilyId));
    assert.ok(!membershipResult.familyIds.includes(unrelatedAdminFamilyId));
  } finally {
    await connection.rollback();
    await connection.end();
  }
});

test('an existing entitlement is classified without removing its linked family from read results', async () => {
  const connection = await mysql.createConnection(requireLoopbackTestDatabase());
  await connection.beginTransaction();
  try {
    const familyId = await insertFamily(connection);
    const parent = await insertVerifiedAccount(connection, { familyId });
    await connection.execute(
      `INSERT INTO account_entitlements
         (family_id, plan_ref, parent_member_limit, managed_device_limit, created_at, updated_at)
       VALUES (?, 'FREE_STARTER', 4, 5, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [familyId],
    );

    assert.deepEqual(
      await resolveParentEmailFamilyLookupOnConnection(connection, parent.emailHash),
      { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'ALREADY_ENTITLED', familyIds: [familyId] },
    );
  } finally {
    await connection.rollback();
    await connection.end();
  }
});
