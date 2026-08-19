import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration0022 = await readFile(new URL('../../migrations/0022_enrollment_administration_persistence.sql', import.meta.url), 'utf8');
const migration0023 = await readFile(new URL('../../migrations/0023_removal_decision_authority_persistence.sql', import.meta.url), 'utf8');

test('0022 creates only verifier and protection-approval persistence tables', () => {
  assert.match(migration0022, /CREATE TABLE enrollment_administration_verifiers \(/);
  assert.match(migration0022, /CREATE TABLE enrollment_protection_approval_requests \(/);
  assert.equal((migration0022.match(/CREATE TABLE /g) ?? []).length, 2);
});

test('verifier persistence stores derived material and failure state, never a raw credential field', () => {
  assert.match(migration0022, /salt_b64 VARCHAR\(32\)/);
  assert.match(migration0022, /verifier_b64 VARCHAR\(64\)/);
  assert.match(migration0022, /failed_attempts TINYINT UNSIGNED/);
  assert.doesNotMatch(migration0022.replace(/--[^\n]*/g, ''), /raw|password|secret|credential/i);
});

test('approval persistence has closed state vocabularies and an authority-applies guard', () => {
  assert.match(migration0022, /protective_authority_applies TINYINT UNSIGNED NOT NULL/);
  assert.match(migration0022, /CHECK \(protective_authority_applies = 1\)/);
  assert.match(migration0022, /state IN \('PARENT_APPROVAL_REQUIRED', 'KEEP_ACTIVE', 'TEMPORARILY_DISABLE', 'ALLOW_REMOVAL'\)/);
  assert.match(migration0022, /decision_method .*REMOTE_PARENT.*LOCAL_ADMINISTRATION_PIN.*AUTHORIZED_RECOVERY/s);
  assert.match(migration0022, /KEY enrollment_protection_approval_family_state_idx \(family_id, state, expires_at\)/);
});

test('0023 does not edit 0022 and only extends the approval table with the signed-decision binding columns', () => {
  assert.doesNotMatch(migration0023, /CREATE TABLE/);
  assert.match(migration0023, /ALTER TABLE enrollment_protection_approval_requests/);
  assert.match(migration0023, /ADD COLUMN decided_by_device_id/);
  assert.match(migration0023, /ADD COLUMN decision_action_id/);
  assert.match(migration0023, /ADD COLUMN idempotency_key/);
  assert.match(migration0023, /ADD COLUMN decision_fingerprint/);
});

test('0023 enforces a single committed decision per signed action id', () => {
  assert.match(migration0023, /CREATE UNIQUE INDEX enrollment_protection_approval_decision_action_uq/);
  assert.match(migration0023, /ON enrollment_protection_approval_requests \(decision_action_id\)/);
});

test('repository uses an atomic pending-and-unexpired compare-and-set transition and persists the signed binding', async () => {
  const source = await readFile(new URL('../../src/familyrbac/MySqlRemovalDecisionRepository.ts', import.meta.url), 'utf8');
  assert.match(source, /state = 'PARENT_APPROVAL_REQUIRED'/);
  assert.match(source, /expires_at > \?/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /return 'ALREADY_DECIDED'/);
  assert.match(source, /decided_by_device_id/);
  assert.match(source, /decision_fingerprint/);
});
