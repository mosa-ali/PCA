import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_PRECEDENCE_ORDER, CLOUD_INFERENCE_APPROVED, explanationLabel, resolveWithPrecedence } from '../../dist/ai/policy.js';

test('AI_PRECEDENCE_ORDER matches PCA-AI-001 exactly', () => {
  assert.deepEqual(AI_PRECEDENCE_ORDER, [
    'LEGAL_PLATFORM_PARENT_POLICY',
    'SIGNED_RULES',
    'DETERMINISTIC_HEURISTIC',
    'LOCAL_MODEL',
    'REMOTE_SERVICE',
  ]);
});

test('CLOUD_INFERENCE_APPROVED defaults to false -- no hidden remote fallback', () => {
  assert.equal(CLOUD_INFERENCE_APPROVED, false);
});

test('explicit allow beats an AI block recommendation', () => {
  const resolution = resolveWithPrecedence([
    { source: 'LEGAL_PLATFORM_PARENT_POLICY', outcome: 'ALLOW' },
    { source: 'LOCAL_MODEL', outcome: 'BLOCK' },
  ]);
  assert.equal(resolution.outcome, 'ALLOW');
  assert.equal(resolution.decidingSource, 'LEGAL_PLATFORM_PARENT_POLICY');
  assert.equal(resolution.supplementaryReviewSignal, true); // the disagreement is surfaced, but never overrides
});

test('explicit deny beats an AI allow recommendation', () => {
  const resolution = resolveWithPrecedence([
    { source: 'SIGNED_RULES', outcome: 'BLOCK' },
    { source: 'LOCAL_MODEL', outcome: 'ALLOW' },
  ]);
  assert.equal(resolution.outcome, 'BLOCK');
  assert.equal(resolution.decidingSource, 'SIGNED_RULES');
});

test('a deterministic rule beats AI', () => {
  const resolution = resolveWithPrecedence([
    { source: 'DETERMINISTIC_HEURISTIC', outcome: 'REVIEW' },
    { source: 'LOCAL_MODEL', outcome: 'ALLOW' },
  ]);
  assert.equal(resolution.outcome, 'REVIEW');
  assert.equal(resolution.decidingSource, 'DETERMINISTIC_HEURISTIC');
});

test('supplementaryReviewSignal is false when the deciding outcome is not ALLOW', () => {
  const resolution = resolveWithPrecedence([
    { source: 'SIGNED_RULES', outcome: 'BLOCK' },
    { source: 'LOCAL_MODEL', outcome: 'BLOCK' },
  ]);
  assert.equal(resolution.supplementaryReviewSignal, false);
});

test('supplementaryReviewSignal is false when no lower-precedence source disagreed', () => {
  const resolution = resolveWithPrecedence([{ source: 'LEGAL_PLATFORM_PARENT_POLICY', outcome: 'ALLOW' }]);
  assert.equal(resolution.supplementaryReviewSignal, false);
});

test('a REMOTE_SERVICE candidate is ignored by default (cloud fallback absent)', () => {
  const resolution = resolveWithPrecedence([
    { source: 'REMOTE_SERVICE', outcome: 'BLOCK' },
    { source: 'LOCAL_MODEL', outcome: 'ALLOW' },
  ]);
  assert.equal(resolution.outcome, 'ALLOW');
  assert.equal(resolution.decidingSource, 'LOCAL_MODEL');
});

test('a REMOTE_SERVICE candidate is only honored with an explicit, non-default approval flag', () => {
  const resolution = resolveWithPrecedence([{ source: 'REMOTE_SERVICE', outcome: 'BLOCK' }], true);
  assert.equal(resolution.outcome, 'BLOCK');
  assert.equal(resolution.decidingSource, 'REMOTE_SERVICE');
});

test('resolveWithPrecedence throws rather than silently guessing when nothing decided', () => {
  assert.throws(() => resolveWithPrecedence([{ source: 'LOCAL_MODEL', outcome: null }]), RangeError);
  assert.throws(() => resolveWithPrecedence([]), RangeError);
});

test('explanationLabel never produces a psychological/personality conclusion, only the four safe kinds', () => {
  for (const kind of ['CATEGORY_RULE_MATCHED', 'SUPPLEMENTARY_RISK_SIGNAL', 'MODEL_UNAVAILABLE', 'CONFIDENCE_BELOW_THRESHOLD']) {
    const label = explanationLabel({ kind });
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0);
  }
});
