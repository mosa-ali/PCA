import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { encryptParentDisplayEmail, decryptParentDisplayEmail } from '../../dist/parentaccount/identityContact.js';
import { MySqlParentIdentityReadRepository, ParentIdentityReadModel } from '../../dist/parentaccount/ParentIdentityProjection.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

test('MySQL: family identity projection honors provisioning precedence and family scope, returns nullable phone, and fails closed without a unique active administrator', async () => {
  const repository = new MySqlParentAccountRepository();
  const legacyAccountId = randomUUID();
  const namedAccountId = randomUUID();
  const secondAdminAccountId = randomUUID();
  const provisionedFamilyId = randomUUID();
  const fallbackFamilyId = randomUUID();
  const otherFamilyId = randomUUID();
  const zeroAdminFamilyId = randomUUID();
  const ambiguousFamilyId = randomUUID();
  const secondAdminEmail = `${secondAdminAccountId}@example.test`;
  const accountRecord = (accountId, email, identity, phoneNumber = null) => ({
    accountId,
    emailHash: createHash('sha256').update(email).digest(),
    passwordHash: '$test-only-parent-password-hash',
    createdAt: new Date(),
    accountType: null,
    estimatedChildCount: null,
    ...(identity ? {
      identity,
      protectedDisplayEmail: encryptParentDisplayEmail(accountId, email),
      phoneNumber,
    } : {}),
  });

  try {
    await repository.createPendingAccount(accountRecord(legacyAccountId, `${legacyAccountId}@example.test`));
    const displayEmail = `${namedAccountId}@example.test`;
    await repository.createPendingAccount(accountRecord(namedAccountId, displayEmail, {
      firstName: 'سارة',
      lastName: 'الحسني',
    }, '+14155552671'));
    await repository.createPendingAccount(accountRecord(secondAdminAccountId, secondAdminEmail, {
      firstName: 'Mina',
      lastName: 'Second',
    }));
    await assert.rejects(
      repository.createPendingAccount(accountRecord(randomUUID(), `${randomUUID()}@example.test`, {
        firstName: 'Sara',
        lastName: '',
      })),
      /parent_accounts_identity_names_check|CHECK constraint/i,
    );
    await assert.rejects(
      repository.createPendingAccount(accountRecord(randomUUID(), `${randomUUID()}@example.test`, {
        firstName: 'Sara',
        lastName: 'Parent',
      }, '4155552671')),
      /parent_accounts_phone_e164_check|CHECK constraint/i,
      'the database also rejects a phone without a country code when bypassing service normalization',
    );

    assert.deepEqual(await repository.findIdentityProfile(legacyAccountId), { firstName: null, lastName: null });
    assert.deepEqual(await repository.findIdentityProfile(namedAccountId), { firstName: 'سارة', lastName: 'الحسني' });
    assert.deepEqual(await repository.findIdentityContact(legacyAccountId), {
      protectedDisplayEmail: null,
      phoneNumber: null,
      phoneVerifiedAt: null,
    });
    const contact = await repository.findIdentityContact(namedAccountId);
    assert.equal(decryptParentDisplayEmail(namedAccountId, contact.protectedDisplayEmail), displayEmail);
    assert.equal(contact.phoneNumber, '+14155552671');
    assert.equal(contact.phoneVerifiedAt, null);

    const now = new Date();
    const verifiedAccounts = [namedAccountId, secondAdminAccountId];
    await runInTransaction(async (conn) => {
      for (const accountId of verifiedAccounts) {
        await execute(conn,
          `UPDATE parent_accounts SET status = 'VERIFIED', verified_at = ?, free_access_mode = 'PERPETUAL' WHERE account_id = ?`,
          [now, accountId],
        );
      }
      await execute(conn,
        `INSERT INTO families (family_id, family_reference_hash, created_at, provisioned_for_account_id) VALUES (?, ?, ?, ?)`,
        [provisionedFamilyId, createHash('sha256').update(provisionedFamilyId).digest(), now, namedAccountId],
      );
      await execute(conn,
        `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'ADMINISTRATOR', 'ACTIVE', ?, ?)`,
        [randomUUID(), provisionedFamilyId, secondAdminAccountId, now, now],
      );
      await execute(conn,
        `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, ?)`,
        [fallbackFamilyId, createHash('sha256').update(fallbackFamilyId).digest(), now],
      );
      await execute(conn,
        `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'ADMINISTRATOR', 'ACTIVE', ?, ?)`,
        [randomUUID(), fallbackFamilyId, namedAccountId, now, now],
      );
      await execute(conn,
        `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, ?)`,
        [otherFamilyId, createHash('sha256').update(otherFamilyId).digest(), now],
      );
      await execute(conn,
        `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'ADMINISTRATOR', 'ACTIVE', ?, ?)`,
        [randomUUID(), otherFamilyId, secondAdminAccountId, now, now],
      );
      await execute(conn,
        `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, ?)`,
        [zeroAdminFamilyId, createHash('sha256').update(zeroAdminFamilyId).digest(), now],
      );
      await execute(conn,
        `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'ADMINISTRATOR', 'REVOKED', ?, ?)`,
        [randomUUID(), zeroAdminFamilyId, secondAdminAccountId, now, now],
      );
      await execute(conn,
        `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, ?)`,
        [ambiguousFamilyId, createHash('sha256').update(ambiguousFamilyId).digest(), now],
      );
      for (const accountId of verifiedAccounts) {
        await execute(conn,
          `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'ADMINISTRATOR', 'ACTIVE', ?, ?)`,
          [randomUUID(), ambiguousFamilyId, accountId, now, now],
        );
      }
    });

    const identityReadModel = new ParentIdentityReadModel(new MySqlParentIdentityReadRepository());
    const platformDto = await identityReadModel.getByFamilyId(provisionedFamilyId);
    assert.deepEqual(platformDto, {
      firstName: 'سارة',
      lastName: 'الحسني',
      email: displayEmail,
      phoneNumber: '+14155552671',
    });
    assert.deepEqual(Object.keys(platformDto).sort(), ['email', 'firstName', 'lastName', 'phoneNumber']);
    assert.deepEqual(await identityReadModel.getByFamilyId(fallbackFamilyId), {
      firstName: 'سارة',
      lastName: 'الحسني',
      email: displayEmail,
      phoneNumber: '+14155552671',
    });
    const otherFamilyDto = await identityReadModel.getByFamilyId(otherFamilyId);
    assert.deepEqual(otherFamilyDto, {
      firstName: 'Mina',
      lastName: 'Second',
      email: secondAdminEmail,
      phoneNumber: null,
    });
    assert.deepEqual(Object.keys(otherFamilyDto).sort(), ['email', 'firstName', 'lastName', 'phoneNumber']);
    assert.equal(await identityReadModel.getByFamilyId(zeroAdminFamilyId), null, 'an existing family with no ACTIVE Administrator has no projected identity');
    await assert.rejects(
      identityReadModel.getByFamilyId(ambiguousFamilyId),
      { name: 'ParentIdentityAmbiguousError' },
    );
    assert.equal(await identityReadModel.getByFamilyId(randomUUID()), null);
    assert.equal(await repository.findIdentityProfile(randomUUID()), null);
  } finally {
    await closePool();
  }
});
