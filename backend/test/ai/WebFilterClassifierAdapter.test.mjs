import assert from 'node:assert/strict';
import test from 'node:test';
import { toWebClassifierResult } from '../../dist/ai/WebFilterClassifierAdapter.js';
import { InMemoryWebRuleRepository, WebRuleService } from '../../dist/web/WebRuleStore.js';
import { WebFilterEngine } from '../../dist/web/WebFilterEngine.js';

function classificationResult(overrides = {}) {
  return {
    modelId: 'model-1',
    modelVersion: '1.0.0',
    surface: 'SAFE_BROWSER_CATEGORY_RISK_SCORING',
    labels: ['EXPLICIT_ADULT'],
    confidence: 'HIGH',
    disposition: 'BLOCK',
    explanation: { kind: 'SUPPLEMENTARY_RISK_SIGNAL' },
    ...overrides,
  };
}

test('toWebClassifierResult adapts a well-formed SAFE_BROWSER result', () => {
  const adapted = toWebClassifierResult(classificationResult(), 'TEXT');
  assert.deepEqual(adapted, { modelVersion: '1.0.0', modality: 'TEXT', confidenceBand: 'HIGH', disposition: 'BLOCK' });
});

test('toWebClassifierResult returns null for a ModelUnavailableResult -- never a fabricated placeholder', () => {
  const adapted = toWebClassifierResult({ reason: 'MODEL_NOT_ACTIVE', explanation: { kind: 'MODEL_UNAVAILABLE' } }, 'TEXT');
  assert.equal(adapted, null);
});

test('toWebClassifierResult returns null for an out-of-surface result (e.g. eye-distance calibration)', () => {
  const adapted = toWebClassifierResult(classificationResult({ surface: 'EYE_DISTANCE_CALIBRATION' }), 'TEXT');
  assert.equal(adapted, null);
});

test('end-to-end: an unavailable AI result never fabricates a classifierResult for WebFilterEngine, so an unmatched domain falls through to default-allow', async () => {
  const rules = new InMemoryWebRuleRepository();
  const engine = new WebFilterEngine(rules);
  const adapted = toWebClassifierResult({ reason: 'RUNTIME_UNAVAILABLE', explanation: { kind: 'MODEL_UNAVAILABLE' } }, 'TEXT');
  assert.equal(adapted, null);
  const decision = await engine.decide('fam-1', 'unknown.example', { classifierResult: adapted ?? undefined });
  assert.equal(decision.outcome, 'ALLOW');
  assert.equal(decision.source, 'DEFAULT');
});

test('end-to-end: an explicit parent allowlist rule still wins even when the adapted AI result recommends BLOCK', async () => {
  const rules = new InMemoryWebRuleRepository();
  await new WebRuleService(rules).setParentRule('fam-1', 'known.example', 'ALLOW', 'PARENT_ALLOWLIST');
  const engine = new WebFilterEngine(rules);
  const adapted = toWebClassifierResult(classificationResult({ disposition: 'BLOCK' }), 'TEXT');
  const decision = await engine.decide('fam-1', 'known.example', { classifierResult: adapted });
  assert.equal(decision.outcome, 'ALLOW');
  assert.equal(decision.source, 'PARENT_ALLOWLIST');
});

test('end-to-end: with no matching rule, the adapted AI BLOCK result is honored', async () => {
  const rules = new InMemoryWebRuleRepository();
  const engine = new WebFilterEngine(rules);
  const adapted = toWebClassifierResult(classificationResult({ disposition: 'BLOCK' }), 'IMAGE');
  const decision = await engine.decide('fam-1', 'unrated.example', { classifierResult: adapted });
  assert.equal(decision.outcome, 'BLOCK');
  assert.equal(decision.source, 'CLASSIFIER');
});
