import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultModeBFeatureFlagState,
  isLegalModeTransition,
  isModeBActive,
  isPlausibleModeBEventShape,
  labelForModeBEvent,
} from '../../dist/youtube/policy.js';

test('the default Mode B feature flag state is disabled and unreviewed', () => {
  const state = defaultModeBFeatureFlagState();
  assert.equal(state.enabled, false);
  assert.equal(state.termsReviewedAt, null);
  assert.equal(isModeBActive(state), false);
});

test('isModeBActive requires BOTH enabled and a recorded terms review', () => {
  assert.equal(isModeBActive({ enabled: true, termsReviewedAt: null }), false);
  assert.equal(isModeBActive({ enabled: false, termsReviewedAt: new Date() }), false);
  assert.equal(isModeBActive({ enabled: true, termsReviewedAt: new Date() }), true);
});

test('A -> B is only legal while Mode B is active', () => {
  assert.equal(isLegalModeTransition('A', 'B', defaultModeBFeatureFlagState()), false);
  assert.equal(isLegalModeTransition('A', 'B', { enabled: true, termsReviewedAt: new Date() }), true);
});

test('B -> A is always legal regardless of flag state', () => {
  assert.equal(isLegalModeTransition('B', 'A', defaultModeBFeatureFlagState()), true);
  assert.equal(isLegalModeTransition('B', 'A', { enabled: true, termsReviewedAt: new Date() }), true);
});

test('there is no A -> A or B -> B transition modeled', () => {
  assert.equal(isLegalModeTransition('A', 'A', { enabled: true, termsReviewedAt: new Date() }), false);
  assert.equal(isLegalModeTransition('B', 'B', { enabled: true, termsReviewedAt: new Date() }), false);
});

test('PLAYBACK_ERROR requires a recognized error code; every other event type requires none', () => {
  assert.equal(isPlausibleModeBEventShape('PLAYBACK_ERROR', 'EMBEDDING_DISABLED'), true);
  assert.equal(isPlausibleModeBEventShape('PLAYBACK_ERROR', null), false);
  assert.equal(isPlausibleModeBEventShape('PLAYBACK_ERROR', 'NOT_A_CODE'), false);
  assert.equal(isPlausibleModeBEventShape('PLAYBACK_STARTED', null), true);
  assert.equal(isPlausibleModeBEventShape('PLAYBACK_STARTED', 'EMBEDDING_DISABLED'), false);
});

test('every Mode B label is prefixed "Mode B—PCA-controlled" and never says "watched"', () => {
  for (const eventType of [
    'PLAYBACK_STARTED',
    'PLAYBACK_STATE_OBSERVED',
    'PLAYBACK_COMPLETED_SIGNAL_OBSERVED',
    'PLAYBACK_ERROR',
  ]) {
    const label = labelForModeBEvent({ eventType });
    assert.match(label, /^Mode B—PCA-controlled:/);
    assert.doesNotMatch(label.toLowerCase(), /watched/);
  }
});
