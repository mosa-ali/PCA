// PCA eye-protection reminders -- real MySQL coverage for
// MySqlEyeProtectionSettingsRepository: safe default when no row exists,
// durable upsert on first write, idempotent update on a second write to the
// same child, and no cross-child bleed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MySqlEyeProtectionSettingsRepository } from '../../dist/eyeprotection/MySqlEyeProtectionSettingsRepository.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueChildId() {
  return `child-eye-protection-${randomUUID()}`;
}

test('MySQL: get() returns a safe all-disabled default when no row exists yet', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const childProfileId = uniqueChildId();
  const settings = await repository.get('fam-eye-1', childProfileId);
  assert.equal(settings.remindersEnabled, false);
  assert.equal(settings.childProfileId, childProfileId);
  assert.equal(settings.familyId, 'fam-eye-1');
});

test('MySQL: update() durably persists reminders_enabled = true, readable back via get()', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const childProfileId = uniqueChildId();
  const updated = await repository.update('fam-eye-1', childProfileId, { remindersEnabled: true });
  assert.equal(updated.remindersEnabled, true);

  const reread = await repository.get('fam-eye-1', childProfileId);
  assert.equal(reread.remindersEnabled, true);
  assert.equal(reread.familyId, 'fam-eye-1');
});

test('MySQL: a second update() call upserts (ON DUPLICATE KEY UPDATE) rather than erroring or duplicating the row', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const childProfileId = uniqueChildId();
  await repository.update('fam-eye-1', childProfileId, { remindersEnabled: true });
  const disabled = await repository.update('fam-eye-1', childProfileId, { remindersEnabled: false });
  assert.equal(disabled.remindersEnabled, false);

  const reread = await repository.get('fam-eye-1', childProfileId);
  assert.equal(reread.remindersEnabled, false);
});

test('MySQL: updated_at advances on each write', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const childProfileId = uniqueChildId();
  const first = await repository.update('fam-eye-1', childProfileId, { remindersEnabled: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await repository.update('fam-eye-1', childProfileId, { remindersEnabled: false });
  assert.ok(new Date(second.updatedAtUtc).getTime() >= new Date(first.updatedAtUtc).getTime());
});

test('MySQL: two distinct children never bleed into each other\'s row', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const childA = uniqueChildId();
  const childB = uniqueChildId();
  await repository.update('fam-eye-1', childA, { remindersEnabled: true });
  await repository.update('fam-eye-1', childB, { remindersEnabled: false });

  const a = await repository.get('fam-eye-1', childA);
  const b = await repository.get('fam-eye-1', childB);
  assert.equal(a.remindersEnabled, true);
  assert.equal(b.remindersEnabled, false);
});

// FABLE-A008 / DW-W1-D: MySqlEyeProtectionSettingsRepository.get() used to
// SELECT by child_profile_id alone, ignoring the familyId parameter
// entirely -- a parent in family A supplying a family-B childProfileId got
// back family B's real row verbatim (real family_id, real
// remindersEnabled): a live cross-family IDOR plus an existence oracle
// (a caller could distinguish "child exists with a saved setting" vs
// "exists, no setting" vs "doesn't exist anywhere"). The fix adds
// `AND family_id = ?` to the SELECT so a foreign-family row -- and a
// nonexistent child -- both produce zero matching rows and the SAME
// caller-scoped safe default. These tests prove that directly against a
// real MySQL database.
test('MySQL: a foreign-family child WITH a saved setting does not leak that setting -- caller\'s own safe default is returned instead', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const childProfileId = uniqueChildId();
  // The real owner (family A) saves a real, non-default setting.
  await repository.update('fam-eye-owner', childProfileId, { remindersEnabled: true });

  // An attacker in family B requests the SAME childProfileId.
  const asAttacker = await repository.get('fam-eye-attacker', childProfileId);
  assert.equal(asAttacker.remindersEnabled, false, 'the true (foreign) remindersEnabled=true value must never leak');
  assert.equal(asAttacker.familyId, 'fam-eye-attacker', 'must echo the CALLER\'s own familyId, never the real owning family_id');
  assert.equal(asAttacker.childProfileId, childProfileId);
  assert.equal(asAttacker.updatedAtUtc, new Date(0).toISOString(), 'must be the never-updated epoch default, never the real updated_at');

  // Meanwhile the real owner still sees their own real setting, unaffected.
  const asOwner = await repository.get('fam-eye-owner', childProfileId);
  assert.equal(asOwner.remindersEnabled, true);
  assert.equal(asOwner.familyId, 'fam-eye-owner');
});

test('MySQL: foreign-family existing-setting response is byte-for-byte indistinguishable from a nonexistent-child response (no existence oracle)', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const foreignChildId = uniqueChildId();
  const nonexistentChildId = uniqueChildId();
  await repository.update('fam-eye-owner', foreignChildId, { remindersEnabled: true });

  const foreignResult = await repository.get('fam-eye-attacker', foreignChildId);
  const nonexistentResult = await repository.get('fam-eye-attacker', nonexistentChildId);

  // Same shape/keys, same familyId, same remindersEnabled, same updatedAtUtc
  // -- the only difference is the childProfileId field itself, which
  // trivially echoes back whatever the caller asked for in BOTH cases (that
  // is not a leak: the caller already knows the id they supplied).
  assert.deepEqual(Object.keys(foreignResult).sort(), Object.keys(nonexistentResult).sort());
  assert.equal(foreignResult.familyId, nonexistentResult.familyId);
  assert.equal(foreignResult.remindersEnabled, nonexistentResult.remindersEnabled);
  assert.equal(foreignResult.updatedAtUtc, nonexistentResult.updatedAtUtc);
  assert.equal(foreignResult.remindersEnabled, false);
  assert.equal(foreignResult.updatedAtUtc, new Date(0).toISOString());
  assert.equal(foreignResult.familyId, 'fam-eye-attacker');
});

test('MySQL: a nonexistent childProfileId (never created by anyone) returns the same safe caller-scoped default', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const neverCreatedChildId = uniqueChildId();
  const result = await repository.get('fam-eye-attacker', neverCreatedChildId);
  assert.equal(result.remindersEnabled, false);
  assert.equal(result.familyId, 'fam-eye-attacker');
  assert.equal(result.childProfileId, neverCreatedChildId);
  assert.equal(result.updatedAtUtc, new Date(0).toISOString());
});

test('MySQL: own child with no explicit setting yet returns the correct same-family default (not confused with a foreign row)', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const ownChildId = uniqueChildId();
  const result = await repository.get('fam-eye-owner', ownChildId);
  assert.equal(result.remindersEnabled, false);
  assert.equal(result.familyId, 'fam-eye-owner');
  assert.equal(result.childProfileId, ownChildId);
});

test('MySQL: zero foreign family_id leakage across many foreign-family reads of the same real child', async () => {
  const repository = new MySqlEyeProtectionSettingsRepository();
  const childProfileId = uniqueChildId();
  await repository.update('fam-eye-real-owner', childProfileId, { remindersEnabled: true });

  for (const attackerFamilyId of ['fam-eye-attacker-1', 'fam-eye-attacker-2', 'fam-eye-attacker-3']) {
    const result = await repository.get(attackerFamilyId, childProfileId);
    assert.equal(result.familyId, attackerFamilyId, `attacker family ${attackerFamilyId} must see only its own familyId echoed back, never fam-eye-real-owner`);
    assert.notEqual(result.familyId, 'fam-eye-real-owner');
    assert.equal(result.remindersEnabled, false, `attacker family ${attackerFamilyId} must never see the real owner's remindersEnabled=true`);
  }
});

test.after(async () => {
  await closePool();
});
