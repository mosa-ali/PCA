import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveClassifierOutcome,
  resolveEffectiveSafeSearchMode,
  resolveWebRuleSource,
  WEB_RULE_SOURCE_PRIORITY,
} from '../../dist/web/policy.js';

function rule(source, listType = 'DENY') {
  return { domain: 'example.com', listType, source, familyId: 'fam-1', createdAt: new Date() };
}

test('resolveWebRuleSource returns null when nothing matched', () => {
  assert.equal(resolveWebRuleSource([]), null);
});

test('SECURITY_DENYLIST outranks a PARENT_ALLOWLIST entry', () => {
  const winner = resolveWebRuleSource([rule('PARENT_ALLOWLIST', 'ALLOW'), rule('SECURITY_DENYLIST')]);
  assert.equal(winner.source, 'SECURITY_DENYLIST');
});

test('PARENT_ALLOWLIST outranks CATEGORY_RULE and SCHEDULE_RULE', () => {
  const winner = resolveWebRuleSource([rule('CATEGORY_RULE'), rule('SCHEDULE_RULE'), rule('PARENT_ALLOWLIST', 'ALLOW')]);
  assert.equal(winner.source, 'PARENT_ALLOWLIST');
});

test('PARENT_DENYLIST outranks ordinary category allow', () => {
  const winner = resolveWebRuleSource([rule('CATEGORY_RULE', 'ALLOW'), rule('PARENT_DENYLIST')]);
  assert.equal(winner.source, 'PARENT_DENYLIST');
});

test('full priority order matches doc 14', () => {
  assert.deepEqual(WEB_RULE_SOURCE_PRIORITY, [
    'SECURITY_DENYLIST',
    'PARENT_ALLOWLIST',
    'PARENT_DENYLIST',
    'CATEGORY_RULE',
    'SCHEDULE_RULE',
  ]);
});

test('resolveClassifierOutcome honors the classifier-reported disposition', () => {
  for (const disposition of ['BLOCK', 'REVIEW', 'ALLOW']) {
    assert.equal(
      resolveClassifierOutcome({ modelVersion: 'v1', modality: 'TEXT', confidenceBand: 'HIGH', disposition }),
      disposition,
    );
  }
});

test('resolveEffectiveSafeSearchMode collapses to OFF when the service does not support it', () => {
  assert.equal(resolveEffectiveSafeSearchMode({ mode: 'STRICT', serviceSupportsSafeSearch: false }), 'OFF');
  assert.equal(resolveEffectiveSafeSearchMode({ mode: 'STRICT', serviceSupportsSafeSearch: true }), 'STRICT');
  assert.equal(resolveEffectiveSafeSearchMode({ mode: 'OFF', serviceSupportsSafeSearch: true }), 'OFF');
});
