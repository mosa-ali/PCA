import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryWebRuleRepository, WebRuleService } from '../../dist/web/WebRuleStore.js';
import { WebFilterEngine } from '../../dist/web/WebFilterEngine.js';

test('decide allows by default with no matching rule', async () => {
  const engine = new WebFilterEngine(new InMemoryWebRuleRepository());
  const decision = await engine.decide('fam-1', 'example.com');
  assert.equal(decision.outcome, 'ALLOW');
  assert.equal(decision.source, 'DEFAULT');
});

test('decide blocks on a parent denylist rule', async () => {
  const repo = new InMemoryWebRuleRepository();
  await new WebRuleService(repo).setParentRule('fam-1', 'bad.example', 'DENY', 'PARENT_DENYLIST');
  const decision = await new WebFilterEngine(repo).decide('fam-1', 'bad.example');
  assert.equal(decision.outcome, 'BLOCK');
  assert.equal(decision.source, 'PARENT_DENYLIST');
});

test('decide never lets a parent allowlist entry override a security denylist entry', async () => {
  const repo = new InMemoryWebRuleRepository();
  await new WebRuleService(repo).setParentRule('fam-1', 'phish.example', 'ALLOW', 'PARENT_ALLOWLIST');
  await repo.put({ domain: 'phish.example', listType: 'DENY', source: 'SECURITY_DENYLIST', familyId: null, createdAt: new Date() });
  const decision = await new WebFilterEngine(repo).decide('fam-1', 'phish.example');
  assert.equal(decision.outcome, 'BLOCK');
  assert.equal(decision.source, 'SECURITY_DENYLIST');
});

test('decide falls through to the classifier only when no rule matched', async () => {
  const repo = new InMemoryWebRuleRepository();
  const decision = await new WebFilterEngine(repo).decide('fam-1', 'unknown.example', {
    classifierResult: { modelVersion: 'v1', modality: 'IMAGE', confidenceBand: 'HIGH', disposition: 'BLOCK' },
  });
  assert.equal(decision.outcome, 'BLOCK');
  assert.equal(decision.source, 'CLASSIFIER');
  assert.equal(decision.coverage, 'FULL_URL');
});

test('a rule match takes precedence over a classifier result', async () => {
  const repo = new InMemoryWebRuleRepository();
  await new WebRuleService(repo).setParentRule('fam-1', 'known.example', 'ALLOW', 'PARENT_ALLOWLIST');
  const decision = await new WebFilterEngine(repo).decide('fam-1', 'known.example', {
    classifierResult: { modelVersion: 'v1', modality: 'IMAGE', confidenceBand: 'HIGH', disposition: 'BLOCK' },
  });
  assert.equal(decision.outcome, 'ALLOW');
  assert.equal(decision.source, 'PARENT_ALLOWLIST');
});

test('decide never claims FULL_URL coverage from a VPN-layer decision', async () => {
  const repo = new InMemoryWebRuleRepository();
  const decision = await new WebFilterEngine(repo).decide('fam-1', 'blocked.example', {
    vpnDecision: { domain: 'blocked.example', outcome: 'BLOCKED', coverage: 'DESTINATION_ONLY' },
  });
  assert.equal(decision.outcome, 'BLOCK');
  assert.equal(decision.coverage, 'DESTINATION_ONLY');
});

test('decide allows (never blocks) when the VPN layer reports unavailable coverage', async () => {
  const repo = new InMemoryWebRuleRepository();
  const decision = await new WebFilterEngine(repo).decide('fam-1', 'unknown.example', {
    vpnDecision: { domain: 'unknown.example', outcome: 'UNAVAILABLE', coverage: 'DOMAIN_ONLY' },
  });
  assert.equal(decision.outcome, 'ALLOW');
  assert.equal(decision.reasonCode, 'network filtering capability was unavailable for this request');
});
