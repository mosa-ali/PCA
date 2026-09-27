import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectParentActorMigrationState } from '../../scripts/lib/parentActorMigrationRecovery.mjs';

const expected = [
  'requested_by_parent_account_id',
  'decided_by_parent_account_id',
  'enrollment_protection_approval_requested_by_parent_idx',
  'enrollment_protection_approval_decided_by_parent_idx',
  'enrollment_protection_approval_requested_by_parent_fk',
  'enrollment_protection_approval_decided_by_parent_fk',
];

function connectionWith(names) {
  return {
    async query(sql) {
      assert.match(sql, /enrollment_protection_approval_requests/);
      assert.match(sql, /referenced_table_name = 'parent_accounts'/);
      return [names.map((object_name) => ({ object_name }))];
    },
  };
}

test('migration 0057 recovery recognizes an absent schema for normal application', async () => {
  assert.equal(await inspectParentActorMigrationState(connectionWith([])), 'ABSENT');
});

test('migration 0057 recovery recognizes only the complete named DDL set', async () => {
  assert.equal(await inspectParentActorMigrationState(connectionWith(expected)), 'COMPLETE');
});

test('migration 0057 recovery fails closed on a partial DDL set', async () => {
  assert.equal(await inspectParentActorMigrationState(connectionWith(expected.slice(0, 3))), 'PARTIAL');
});
