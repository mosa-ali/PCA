// PCA-DW-W3-D -- real MySQL coverage for MySqlProfileModeRepository: safe
// 'A' default when no row exists, durable upsert on first write, idempotent
// update on a second write to the same profile, and -- mirroring
// FABLE-A008/DW-W1-D's already-fixed eye-protection precedent exactly --
// no cross-family bleed or existence oracle.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MySqlProfileModeRepository } from '../../dist/youtube/MySqlProfileModeRepository.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueProfileId() {
  return `profile-mode-${randomUUID()}`;
}

test('MySQL: get() returns the safe Mode A default when no row exists yet', async () => {
  const repository = new MySqlProfileModeRepository();
  const profileId = uniqueProfileId();
  const mode = await repository.get('fam-mode-1', profileId);
  assert.equal(mode, 'A');
});

test('MySQL: put() durably persists Mode B, readable back via get()', async () => {
  const repository = new MySqlProfileModeRepository();
  const profileId = uniqueProfileId();
  await repository.put('fam-mode-1', profileId, 'B');
  const reread = await repository.get('fam-mode-1', profileId);
  assert.equal(reread, 'B');
});

test('MySQL: a second put() call upserts (ON DUPLICATE KEY UPDATE) rather than erroring or duplicating the row', async () => {
  const repository = new MySqlProfileModeRepository();
  const profileId = uniqueProfileId();
  await repository.put('fam-mode-1', profileId, 'B');
  await repository.put('fam-mode-1', profileId, 'A');
  const reread = await repository.get('fam-mode-1', profileId);
  assert.equal(reread, 'A');
});

test('MySQL: two distinct profiles never bleed into each other\'s row', async () => {
  const repository = new MySqlProfileModeRepository();
  const profileA = uniqueProfileId();
  const profileB = uniqueProfileId();
  await repository.put('fam-mode-1', profileA, 'B');
  await repository.put('fam-mode-1', profileB, 'A');

  assert.equal(await repository.get('fam-mode-1', profileA), 'B');
  assert.equal(await repository.get('fam-mode-1', profileB), 'A');
});

// FABLE-A008/DW-W1-D pattern, applied here: a foreign family's real Mode B
// must never leak through a cross-family get(); a nonexistent profileId and
// a real-but-foreign profileId must be indistinguishable (both the safe 'A'
// default).
test('SECURITY: a foreign-family profile in Mode B does not leak that mode -- caller\'s own safe Mode A default is returned instead', async () => {
  const repository = new MySqlProfileModeRepository();
  const profileId = uniqueProfileId();
  await repository.put('fam-mode-owner', profileId, 'B');

  const asAttacker = await repository.get('fam-mode-attacker', profileId);
  assert.equal(asAttacker, 'A', 'the true (foreign) Mode B value must never leak');

  const asOwner = await repository.get('fam-mode-owner', profileId);
  assert.equal(asOwner, 'B', 'meanwhile the real owner still sees their own real mode, unaffected');
});

test('SECURITY: foreign-family existing-mode response is indistinguishable from a nonexistent-profile response (no existence oracle)', async () => {
  const repository = new MySqlProfileModeRepository();
  const foreignProfileId = uniqueProfileId();
  const nonexistentProfileId = uniqueProfileId();
  await repository.put('fam-mode-owner', foreignProfileId, 'B');

  const foreignResult = await repository.get('fam-mode-attacker', foreignProfileId);
  const nonexistentResult = await repository.get('fam-mode-attacker', nonexistentProfileId);
  assert.equal(foreignResult, nonexistentResult);
  assert.equal(foreignResult, 'A');
});

test('SECURITY: zero foreign-mode leakage across many foreign-family reads of the same real profile', async () => {
  const repository = new MySqlProfileModeRepository();
  const profileId = uniqueProfileId();
  await repository.put('fam-mode-real-owner', profileId, 'B');

  for (const attackerFamilyId of ['fam-mode-attacker-1', 'fam-mode-attacker-2', 'fam-mode-attacker-3']) {
    const result = await repository.get(attackerFamilyId, profileId);
    assert.equal(result, 'A', `attacker family ${attackerFamilyId} must never see the real owner's Mode B`);
  }
});

test.after(async () => {
  await closePool();
});
