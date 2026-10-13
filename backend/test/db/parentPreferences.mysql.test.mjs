import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlParentPreferenceRepository } from '../../dist/parentaccount/MySqlParentPreferenceRepository.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlParentPreferenceRepository();

after(async () => {
  await closePool();
});

test('MySQL Parent preferences persist partial updates and remain scoped to the account', async () => {
  const accountId = randomUUID();
  const otherAccountId = randomUUID();
  const destination = `parent-${accountId}@example.test`;

  try {
    assert.deepEqual(await repository.get(accountId), {
      accountId,
      language: 'en',
      emailAlertsEnabled: true,
      pushRequestsEnabled: true,
      emailDestination: null,
      emailDestinationState: 'UNVERIFIED',
      updatedAtUtc: new Date(0).toISOString(),
    });

    const updated = await repository.update(accountId, {
      language: 'ar',
      emailAlertsEnabled: false,
      pushRequestsEnabled: false,
      emailDestination: destination,
    });
    assert.equal(updated.accountId, accountId);
    assert.equal(updated.language, 'ar');
    assert.equal(updated.emailAlertsEnabled, false);
    assert.equal(updated.pushRequestsEnabled, false);
    assert.equal(updated.emailDestination, destination);
    assert.equal(updated.emailDestinationState, 'UNVERIFIED');
    assert.ok(Number.isFinite(Date.parse(updated.updatedAtUtc)));

    assert.deepEqual(await repository.get(otherAccountId), {
      accountId: otherAccountId,
      language: 'en',
      emailAlertsEnabled: true,
      pushRequestsEnabled: true,
      emailDestination: null,
      emailDestinationState: 'UNVERIFIED',
      updatedAtUtc: new Date(0).toISOString(),
    }, 'another account must not observe this account\'s persisted preferences');

    const partialUpdate = await repository.update(accountId, { pushRequestsEnabled: true });
    assert.equal(partialUpdate.language, 'ar');
    assert.equal(partialUpdate.emailAlertsEnabled, false);
    assert.equal(partialUpdate.pushRequestsEnabled, true);
    assert.equal(partialUpdate.emailDestination, destination);

    // A verification state is controlled by the verification flow, not by
    // preference updates. Changing the destination must revoke that state.
    await getPool().query(
      `UPDATE parent_account_preferences SET email_destination_state = 'VERIFIED' WHERE account_id = ?`,
      [accountId],
    );
    const changedDestination = await repository.update(accountId, {
      emailDestination: `updated-${accountId}@example.test`,
    });
    assert.equal(changedDestination.emailDestination, `updated-${accountId}@example.test`);
    assert.equal(changedDestination.emailDestinationState, 'UNVERIFIED');
  } finally {
    await getPool().query('DELETE FROM parent_account_preferences WHERE account_id IN (?, ?)', [accountId, otherAccountId]);
  }
});
