import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryModeBFeatureFlagRepository, ModeBFeatureFlagService } from '../../dist/youtube/ModeBFeatureFlagStore.js';
import { isModeBActive } from '../../dist/youtube/policy.js';

test('a fresh repository defaults to disabled, unreviewed', async () => {
  const service = new ModeBFeatureFlagService(new InMemoryModeBFeatureFlagRepository());
  const state = await service.getState();
  assert.equal(state.enabled, false);
  assert.equal(state.termsReviewedAt, null);
});

test('enabling alone does not activate Mode B without a recorded terms review', async () => {
  const service = new ModeBFeatureFlagService(new InMemoryModeBFeatureFlagRepository(), () => new Date('2026-01-01T00:00:00Z'));
  const state = await service.enable();
  assert.equal(isModeBActive(state), false);
});

test('enable + recordTermsReview together activate Mode B', async () => {
  const service = new ModeBFeatureFlagService(new InMemoryModeBFeatureFlagRepository(), () => new Date('2026-01-01T00:00:00Z'));
  await service.enable();
  const state = await service.recordTermsReview();
  assert.equal(isModeBActive(state), true);
  assert.equal(state.termsReviewedAt.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('disable deactivates Mode B even with a prior terms review', async () => {
  const service = new ModeBFeatureFlagService(new InMemoryModeBFeatureFlagRepository(), () => new Date('2026-01-01T00:00:00Z'));
  await service.enable();
  await service.recordTermsReview();
  const state = await service.disable();
  assert.equal(isModeBActive(state), false);
});
