import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryWebRuleRepository, WebRuleService } from '../../dist/web/WebRuleStore.js';
import { WebFilterEngine } from '../../dist/web/WebFilterEngine.js';
import { BlockDecisionStateService, InMemoryBlockDecisionStateRepository } from '../../dist/safebrowser/BlockDecisionStateStore.js';
import { NavigationPolicyError, SafeBrowserNavigationPolicy } from '../../dist/safebrowser/SafeBrowserNavigationPolicy.js';

function makePolicy() {
  const rules = new InMemoryWebRuleRepository();
  const engine = new WebFilterEngine(rules);
  const blockDecisions = new BlockDecisionStateService(new InMemoryBlockDecisionStateRepository(), () => new Date('2026-01-01T00:00:00Z'));
  const policy = new SafeBrowserNavigationPolicy(engine, blockDecisions);
  return { rules, policy };
}

test('evaluateNavigation allows and applies SafeSearch when the service supports it', async () => {
  const { policy } = makePolicy();
  const outcome = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://search.example/?q=x', {
    safeSearch: { mode: 'STRICT', serviceSupportsSafeSearch: true },
  });
  assert.equal(outcome.status, 'ALLOW');
  assert.equal(outcome.safeSearchMode, 'STRICT');
});

test('evaluateNavigation never claims SafeSearch enforcement the service does not support', async () => {
  const { policy } = makePolicy();
  const outcome = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://search.example/?q=x', {
    safeSearch: { mode: 'STRICT', serviceSupportsSafeSearch: false },
  });
  assert.equal(outcome.status, 'ALLOW');
  assert.equal(outcome.safeSearchMode, 'OFF');
});

test('evaluateNavigation blocks on a parent denylist rule and records a local BlockDecisionState with the full URL', async () => {
  const { rules, policy } = makePolicy();
  await new WebRuleService(rules).setParentRule('fam-1', 'bad.example', 'DENY', 'PARENT_DENYLIST');
  const outcome = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://bad.example/page', { pageTitle: 'Bad Page' });
  assert.equal(outcome.status, 'BLOCK');
  assert.equal(outcome.blockDecision.url, 'https://bad.example/page');
  assert.equal(outcome.blockDecision.pageTitle, 'Bad Page');
  assert.equal(outcome.blockDecision.requestable, true);
});

test('evaluateNavigation surfaces REVIEW distinctly from BLOCK for an ambiguous classifier result', async () => {
  const { policy } = makePolicy();
  const outcome = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://unknown.example/', {
    classifierResult: { modelVersion: 'v1', modality: 'TEXT', confidenceBand: 'LOW', disposition: 'REVIEW' },
  });
  assert.equal(outcome.status, 'REVIEW');
  assert.equal(outcome.blockDecision.outcome, 'REVIEW');
});

test('evaluateNavigation never records a BlockDecisionState for an ALLOW outcome', async () => {
  const { rules, policy } = makePolicy();
  const outcome = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://ok.example/');
  assert.equal(outcome.status, 'ALLOW');
  assert.equal('blockDecision' in outcome, false);
});

test('evaluateNavigation rejects a URL that cannot be canonicalized to a domain', async () => {
  const { policy } = makePolicy();
  await assert.rejects(
    () => policy.evaluateNavigation('fam-1', 'prof-1', 'not a url'),
    (err) => err instanceof NavigationPolicyError,
  );
});
