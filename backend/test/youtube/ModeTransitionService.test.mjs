import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryModeBFeatureFlagRepository } from '../../dist/youtube/ModeBFeatureFlagStore.js';
import { InMemoryProfileModeRepository, ModeTransitionError, ModeTransitionService } from '../../dist/youtube/ModeTransitionService.js';

test('a profile with no prior write defaults to Mode A', async () => {
  const service = new ModeTransitionService(new InMemoryProfileModeRepository(), new InMemoryModeBFeatureFlagRepository());
  assert.equal(await service.getMode('fam-1', 'prof-1'), 'A');
});

test('transitionTo A -> B is rejected while the feature flag is inactive (default OFF)', async () => {
  const service = new ModeTransitionService(new InMemoryProfileModeRepository(), new InMemoryModeBFeatureFlagRepository());
  await assert.rejects(
    () => service.transitionTo('fam-1', 'prof-1', 'B'),
    (err) => err instanceof ModeTransitionError,
  );
});

test('transitionTo A -> B succeeds once the flag is fully active', async () => {
  const flags = new InMemoryModeBFeatureFlagRepository();
  await flags.put({ enabled: true, termsReviewedAt: new Date('2026-01-01T00:00:00Z') });
  const service = new ModeTransitionService(new InMemoryProfileModeRepository(), flags);
  const mode = await service.transitionTo('fam-1', 'prof-1', 'B');
  assert.equal(mode, 'B');
  assert.equal(await service.getMode('fam-1', 'prof-1'), 'B');
});

test('transitionTo B -> A always succeeds, even with the flag inactive', async () => {
  const flags = new InMemoryModeBFeatureFlagRepository();
  await flags.put({ enabled: true, termsReviewedAt: new Date('2026-01-01T00:00:00Z') });
  const profileModes = new InMemoryProfileModeRepository();
  const service = new ModeTransitionService(profileModes, flags);
  await service.transitionTo('fam-1', 'prof-1', 'B');
  await flags.put({ enabled: false, termsReviewedAt: new Date('2026-01-01T00:00:00Z') });
  const mode = await service.transitionTo('fam-1', 'prof-1', 'A');
  assert.equal(mode, 'A');
});

test('revertIfModeBInactive moves a profile stuck in B back to A once the flag is disabled', async () => {
  const flags = new InMemoryModeBFeatureFlagRepository();
  await flags.put({ enabled: true, termsReviewedAt: new Date('2026-01-01T00:00:00Z') });
  const profileModes = new InMemoryProfileModeRepository();
  const service = new ModeTransitionService(profileModes, flags);
  await service.transitionTo('fam-1', 'prof-1', 'B');

  await flags.put({ enabled: false, termsReviewedAt: new Date('2026-01-01T00:00:00Z') });
  const mode = await service.revertIfModeBInactive('fam-1', 'prof-1');
  assert.equal(mode, 'A');
  assert.equal(await service.getMode('fam-1', 'prof-1'), 'A');
});

test('revertIfModeBInactive is a no-op for a profile already in A or while B remains active', async () => {
  const flags = new InMemoryModeBFeatureFlagRepository();
  const service = new ModeTransitionService(new InMemoryProfileModeRepository(), flags);
  assert.equal(await service.revertIfModeBInactive('fam-1', 'prof-1'), 'A');

  await flags.put({ enabled: true, termsReviewedAt: new Date('2026-01-01T00:00:00Z') });
  const profileModes = new InMemoryProfileModeRepository();
  const activeService = new ModeTransitionService(profileModes, flags);
  await activeService.transitionTo('fam-1', 'prof-2', 'B');
  assert.equal(await activeService.revertIfModeBInactive('fam-1', 'prof-2'), 'B');
});
