import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0044_pca_dec_020_r1_genesis_challenges_and_epoch_floors.sql', import.meta.url), 'utf8');
const executable = migration.replace(/--[^\n]*/g, '');

test('R1 migration 0044 is additive-only and contains both challenge stores', () => {
  assert.match(executable, /CREATE TABLE parent_genesis_challenges/i);
  assert.match(executable, /CREATE TABLE family_authority_request_challenges/i);
  assert.match(executable, /ADD COLUMN required_trust_set_epoch/i);
  assert.match(executable, /ADD COLUMN required_key_epoch/i);
  assert.doesNotMatch(executable, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
  assert.doesNotMatch(executable, /\b(UPDATE|DELETE|INSERT)\s+/i);
});

test('R1 migration 0044 keeps challenge data opaque and public-key-only', () => {
  assert.doesNotMatch(executable, /private_key|password|otp|token_plaintext|email_address/i);
  assert.match(executable, /candidate_public_key\s+VARCHAR\(128\)/i);
  assert.match(executable, /public_key\s+VARCHAR\(128\)/i);
  assert.match(executable, /request_digest\s+VARCHAR\(64\)/i);
});
