import assert from 'node:assert/strict';
import test from 'node:test';
import { WebFilteringDashboardCardProvider } from '../../dist/parentpanel/WebFilteringDashboardCardProvider.js';
import { BlockDecisionStateService, InMemoryBlockDecisionStateRepository } from '../../dist/safebrowser/BlockDecisionStateStore.js';

function decision(overrides = {}) {
  return {
    domain: 'blocked.example',
    outcome: 'BLOCK',
    source: 'PARENT_DENYLIST',
    reasonCode: "blocked by your parent's block list",
    reasonId: 'PARENT_DENYLIST',
    coverage: 'DOMAIN_ONLY',
    ...overrides,
  };
}

test('kind is WEB_FILTERING', () => {
  const provider = new WebFilteringDashboardCardProvider(new InMemoryBlockDecisionStateRepository(), 'COMPLETE');
  assert.equal(provider.kind, 'WEB_FILTERING');
});

test('a COMPLETE source with no recorded decisions reports AVAILABLE with an honest zero summary', async () => {
  // The zero is only a fact because the caller ASSERTED the source is complete.
  // This test previously read "never UNAVAILABLE" and pinned the defect: the
  // production source is in-memory and nothing ever writes to it, so the card
  // reported this exact AVAILABLE + "No recent site blocks" to every parent
  // every time, from an empty map, and dashboard/types.ts forbids precisely
  // that ("a card must never report AVAILABLE merely because its UI exists").
  const provider = new WebFilteringDashboardCardProvider(new InMemoryBlockDecisionStateRepository(), 'COMPLETE');
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.kind, 'WEB_FILTERING');
  assert.equal(card.capabilityState, 'AVAILABLE');
  assert.equal(card.summaryLabel, 'No recent site blocks');
  assert.equal(card.lastAcknowledgedPolicyRevision, null);
  assert.equal(card.pendingOrOfflineStatus, 'NONE');
});

test('an INCOMPLETE_EPHEMERAL source never reports AVAILABLE, and never claims there were no blocks', async () => {
  // The production posture: InMemoryBlockDecisionStateRepository, device-local
  // by contract, empty here by construction. "No recent site blocks" and a zero
  // count are both forbidden answers, because the card cannot tell the
  // difference between "nothing was blocked" and "we cannot see" -- and a parent
  // inevitably reads the first.
  const provider = new WebFilteringDashboardCardProvider(new InMemoryBlockDecisionStateRepository(), 'INCOMPLETE_EPHEMERAL');
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.kind, 'WEB_FILTERING');
  assert.equal(card.capabilityState, 'UNAVAILABLE');
  assert.equal(card.summaryLabel, 'Site block history unavailable');
  assert.doesNotMatch(card.summaryLabel, /No recent site blocks/);
  assert.doesNotMatch(card.summaryLabel, /\d/, 'an unavailable card must not present a count as a fact');
  // A zero and an unknown must not render the same way -- that is the whole point.
  assert.notEqual(card.summaryLabel, 'No recent site blocks');
});

test('an INCOMPLETE_EPHEMERAL source reports UNAVAILABLE even when it DOES hold decisions, rather than presenting its incomplete view as a count', async () => {
  // The subtler half: the store is not merely empty, it is unreliable. Even with
  // rows in it, its view of the family is partial (process-local, lost on
  // restart, and never fed by any writer in production), so surfacing a count
  // would still be a claim the source cannot support.
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, 'INCOMPLETE_EPHEMERAL', () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.capabilityState, 'UNAVAILABLE');
  assert.equal(card.summaryLabel, 'Site block history unavailable');
});

test('summarizes recent BLOCK decisions as a plain count, singular vs. plural', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, 'COMPLETE', () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.summaryLabel, '1 recent site block');

  await service.record('fam-1', 'prof-1', 'https://b.example/', null, decision({ domain: 'b.example' }));
  const card2 = await provider.getCard('fam-1', null);
  assert.equal(card2.summaryLabel, '2 recent site blocks');
});

test('separates a REVIEW decision into a "pending review" count, never conflating it with a hard block', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example', outcome: 'BLOCK' }));
  await service.record('fam-1', 'prof-1', 'https://b.example/', null, decision({ domain: 'b.example', outcome: 'REVIEW', source: 'CATEGORY_RULE' }));
  const provider = new WebFilteringDashboardCardProvider(repository, 'COMPLETE', () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.summaryLabel, '2 recent site blocks (1 pending review)');
});

test('excludes a decision older than the recent window, never inflating the count with stale data', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2025-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://old.example/', null, decision({ domain: 'old.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, 'COMPLETE', () => new Date('2026-01-01T00:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.summaryLabel, 'No recent site blocks');
});

test('a family-wide read (childId null) aggregates every child in the family, never leaking into another family', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  await service.record('fam-1', 'prof-2', 'https://b.example/', null, decision({ domain: 'b.example' }));
  await service.record('fam-2', 'prof-9', 'https://c.example/', null, decision({ domain: 'c.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, 'COMPLETE', () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.summaryLabel, '2 recent site blocks');
});

test('a per-child read (childId supplied) narrows the count to that child only', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  await service.record('fam-1', 'prof-2', 'https://b.example/', null, decision({ domain: 'b.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, 'COMPLETE', () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', 'prof-2');
  assert.equal(card.summaryLabel, '1 recent site block');
});

test('the card never carries a domain, url, pageTitle, or reasonCode field -- summary label only, matching DashboardCard\'s own privacy contract', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://secret-site.example/private-path', 'A Private Page Title', decision({ domain: 'secret-site.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, 'COMPLETE', () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  const keys = Object.keys(card).sort();
  assert.deepEqual(keys, ['capabilityState', 'kind', 'lastAcknowledgedPolicyRevision', 'pendingOrOfflineStatus', 'summaryLabel']);
  assert.doesNotMatch(card.summaryLabel, /secret-site|private-path|Private Page Title/);
});
