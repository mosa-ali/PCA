import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0022_enrollment_administration_persistence.sql', import.meta.url), 'utf8');

test('0022 creates only verifier and protection-approval persistence tables', () => {
  assert.match(migration, /CREATE TABLE enrollment_administration_verifiers \(/);
  assert.match(migration, /CREATE TABLE enrollment_protection_approval_requests \(/);
  assert.equal((migration.match(/CREATE TABLE /g) ?? []).length, 2);
});

test('verifier persistence stores derived material and failure state, never a raw credential field', () => {
  assert.match(migration, /salt_b64 VARCHAR\(32\)/);
  assert.match(migration, /verifier_b64 VARCHAR\(64\)/);
  assert.match(migration, /failed_attempts TINYINT UNSIGNED/);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ''), /raw|password|secret|credential/i);
});

test('approval persistence has closed state vocabularies and an authority-applies guard', () => {
  assert.match(migration, /protective_authority_applies TINYINT UNSIGNED NOT NULL/);
  assert.match(migration, /CHECK \(protective_authority_applies = 1\)/);
  assert.match(migration, /state IN \('PARENT_APPROVAL_REQUIRED', 'KEEP_ACTIVE', 'TEMPORARILY_DISABLE', 'ALLOW_REMOVAL'\)/);
  assert.match(migration, /decision_method .*REMOTE_PARENT.*LOCAL_ADMINISTRATION_PIN.*AUTHORIZED_RECOVERY/s);
  assert.match(migration, /KEY enrollment_protection_approval_family_state_idx \(family_id, state, expires_at\)/);
});

test('approval repository uses an atomic pending-and-unexpired compare-and-set transition', async () => {
  const source = await readFile(new URL('../../src/enrollment/MySqlProtectionApprovalRepository.ts', import.meta.url), 'utf8');
  assert.match(source, /state = 'PARENT_APPROVAL_REQUIRED'/);
  assert.match(source, /expires_at > \?/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /return 'ALREADY_DECIDED'/);
});
