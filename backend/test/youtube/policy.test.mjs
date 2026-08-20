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

// ---- doc 20 PCA-FR-113: Mode B parent-report labels must be genuinely localized, never a raw English fallback ----

test('labelForModeBEvent defaults to the exact pre-existing English label when no locale is supplied', () => {
  assert.equal(labelForModeBEvent({ eventType: 'PLAYBACK_STARTED' }), 'Mode B—PCA-controlled: started');
  assert.equal(labelForModeBEvent({ eventType: 'PLAYBACK_STARTED' }, 'en'), 'Mode B—PCA-controlled: started');
});

test('labelForModeBEvent produces a genuine Arabic label for every event type when locale=ar is requested, with no English fallback leaking in', () => {
  const expected = {
    PLAYBACK_STARTED: 'الوضع B — بإشراف PCA: بدأ التشغيل',
    PLAYBACK_STATE_OBSERVED: 'الوضع B — بإشراف PCA: تم رصد حالة التشغيل',
    PLAYBACK_COMPLETED_SIGNAL_OBSERVED: 'الوضع B — بإشراف PCA: تم رصد إشارة الانتهاء',
    PLAYBACK_ERROR: 'الوضع B — بإشراف PCA: خطأ في التشغيل',
  };
  for (const [eventType, expectedLabel] of Object.entries(expected)) {
    const label = labelForModeBEvent({ eventType }, 'ar');
    assert.equal(label, expectedLabel);
    // "B" (the mode letter) and "PCA" (the product name) are deliberate LTR
    // tokens inside the Arabic label -- strip those before checking that no
    // OTHER English text (a mixed-language fallback) leaked in.
    assert.equal(/[A-Za-z]/.test(label.replaceAll('PCA', '').replaceAll('B', '')), false);
  }
});
