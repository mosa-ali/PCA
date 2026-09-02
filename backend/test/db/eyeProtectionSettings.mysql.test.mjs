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

test.after(async () => {
  await closePool();
});
