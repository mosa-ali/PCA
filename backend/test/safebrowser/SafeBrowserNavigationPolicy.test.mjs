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

// PCA-16A correction (BACKEND_I18N_NOT_WIRED, section 6): REAL production-path integration
// tests -- these exercise SafeBrowserNavigationPolicy.evaluateNavigation() end-to-end (the
// actual Safe Browser decision route, not translate() called directly) and assert the actually
// returned presentation text is genuinely localized.

test('AR ROUTE: evaluateNavigation with locale "ar" returns an Arabic reasonCode through the real decision path', async () => {
  const { rules, policy } = makePolicy();
  await new WebRuleService(rules).setParentRule('fam-1', 'bad.example', 'DENY', 'PARENT_DENYLIST');
  const outcome = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://bad.example/page', {}, 'ar');
  assert.equal(outcome.status, 'BLOCK');
  assert.equal(outcome.blockDecision.reasonId, 'PARENT_DENYLIST');
  assert.equal(outcome.blockDecision.reasonCode, 'محظور بواسطة قائمة الحظر الخاصة بعائلتك');
  // Sanity: this is genuinely Arabic script, not a byte-identical English fallback string.
  assert.ok(/[؀-ۿ]/.test(outcome.blockDecision.reasonCode));
});

test('AR ROUTE: the default-allow / VPN-unavailable path also returns Arabic through the real decision path', async () => {
  const { policy } = makePolicy();
  const engineOnlyRepo = new InMemoryWebRuleRepository();
  const engine = new WebFilterEngine(engineOnlyRepo);
  const decision = await engine.decide('fam-1', 'unknown.example', {
    vpnDecision: { domain: 'unknown.example', outcome: 'UNAVAILABLE', coverage: 'DOMAIN_ONLY' },
  }, 'ar');
  assert.equal(decision.reasonId, 'VPN_UNAVAILABLE');
  assert.equal(decision.reasonCode, 'كانت إمكانية تصفية الشبكة غير متاحة لهذا الطلب');
});

test('EN ROUTE (regression): evaluateNavigation with no locale argument (or explicit "en") still returns the exact prior English text', async () => {
  const { rules, policy } = makePolicy();
  await new WebRuleService(rules).setParentRule('fam-1', 'bad.example', 'DENY', 'PARENT_DENYLIST');

  const defaulted = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://bad.example/page');
  assert.equal(defaulted.blockDecision.reasonCode, "blocked by your family's block list");

  const explicit = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://bad.example/page2', {}, 'en');
  assert.equal(explicit.blockDecision.reasonCode, "blocked by your family's block list");
});

test('reasonId (stable machine key) is identical across locales -- policy/audit code never depends on translated prose', async () => {
  const { rules, policy } = makePolicy();
  await new WebRuleService(rules).setParentRule('fam-1', 'bad.example', 'DENY', 'PARENT_DENYLIST');
  const en = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://bad.example/page', {}, 'en');
  const ar = await policy.evaluateNavigation('fam-1', 'prof-1', 'https://bad.example/page3', {}, 'ar');
  assert.equal(en.blockDecision.reasonId, ar.blockDecision.reasonId);
  assert.equal(en.blockDecision.source, ar.blockDecision.source);
  assert.notEqual(en.blockDecision.reasonCode, ar.blockDecision.reasonCode);
});
