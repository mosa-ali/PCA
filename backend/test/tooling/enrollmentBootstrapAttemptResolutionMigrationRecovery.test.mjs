import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectEnrollmentBootstrapAttemptResolutionMigrationState } from '../../scripts/lib/enrollmentBootstrapAttemptResolutionMigrationRecovery.mjs';

const before = [
  'before:not_null:device_id',
  'before:not_null:signing_key_id',
  'before:not_null:encryption_key_id',
  'before:token_hash_idx',
  'before:completed_status_check',
];

const after = [
  'after:nullable:device_id',
  'after:nullable:signing_key_id',
  'after:nullable:encryption_key_id',
  'after:unique_token_hash_key',
  'after:prepared_status_check',
  'after:device_result_check',
];

function connectionWith(objects) {
  return {
    async query(sql) {
      assert.match(sql, /information_schema\.columns/);
      assert.match(sql, /information_schema\.statistics/);
      assert.match(sql, /information_schema\.check_constraints/);
      assert.match(sql, /enrollment_bootstrap_attempts/);
      return [objects.map((object_name) => ({ object_name }))];
    },
  };
}

test('migration 0064 recovery recognizes the complete pre-migration shape', async () => {
  assert.equal(await inspectEnrollmentBootstrapAttemptResolutionMigrationState(connectionWith(before)), 'ABSENT');
});

test('migration 0064 recovery recognizes only the complete post-migration shape', async () => {
  assert.equal(await inspectEnrollmentBootstrapAttemptResolutionMigrationState(connectionWith(after)), 'COMPLETE');
});

test('migration 0064 recovery fails closed on an ambiguous partial schema shape', async () => {
  assert.equal(await inspectEnrollmentBootstrapAttemptResolutionMigrationState(connectionWith(after.slice(0, 4))), 'PARTIAL');
  assert.equal(await inspectEnrollmentBootstrapAttemptResolutionMigrationState(connectionWith([])), 'PARTIAL');
});
