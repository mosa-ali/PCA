import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryEyeProtectionSettingsRepository } from '../../dist/eyeprotection/EyeProtectionSettingsRepository.js';
import { EyeProtectionSettingsService } from '../../dist/eyeprotection/EyeProtectionSettingsService.js';

function makeService() {
  const repository = new InMemoryEyeProtectionSettingsRepository();
  return { repository, service: new EyeProtectionSettingsService(repository) };
}

test('get() returns a safe all-disabled default when no row exists yet', async () => {
  const { service } = makeService();
  const settings = await service.get('fam-1', 'child-1');
  assert.equal(settings.remindersEnabled, false);
  assert.equal(settings.childProfileId, 'child-1');
  assert.equal(settings.updatedAtUtc, new Date(0).toISOString());
});

test('authorized Parent-session writes persist and round-trip through the repository', async () => {
  const { repository, service } = makeService();
  const updated = await service.updateReminders('fam-1', 'child-1', true);
  assert.equal(updated.remindersEnabled, true);
  assert.equal((await repository.get('fam-1', 'child-1')).remindersEnabled, true);
  const disabled = await service.updateReminders('fam-1', 'child-1', false);
  assert.equal(disabled.remindersEnabled, false);
});
