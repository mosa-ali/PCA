import assert from 'node:assert/strict';
import test from 'node:test';
import { WebFilteringDashboardCardProvider } from '../../dist/parentpanel/WebFilteringDashboardCardProvider.js';
import { BlockDecisionStateService, InMemoryBlockDecisionStateRepository } from '../../dist/safebrowser/BlockDecisionStateStore.js';

function decision(overrides = {}) {
  return {
    domain: 'blocked.example',
    outcome: 'BLOCK',
    source: 'PARENT_DENYLIST',
    reasonCode: "blocked by your family's block list",
    reasonId: 'PARENT_DENYLIST',
    coverage: 'DOMAIN_ONLY',
    ...overrides,
  };
}

test('kind is WEB_FILTERING', () => {
  const provider = new WebFilteringDashboardCardProvider(new InMemoryBlockDecisionStateRepository());
  assert.equal(provider.kind, 'WEB_FILTERING');
});

test('a family with no recorded decisions reports AVAILABLE with an honest zero summary, never UNAVAILABLE', async () => {
  const provider = new WebFilteringDashboardCardProvider(new InMemoryBlockDecisionStateRepository());
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.kind, 'WEB_FILTERING');
  assert.equal(card.capabilityState, 'AVAILABLE');
  assert.equal(card.summaryLabel, 'No recent site blocks');
  assert.equal(card.lastAcknowledgedPolicyRevision, null);
  assert.equal(card.pendingOrOfflineStatus, 'NONE');
});

test('summarizes recent BLOCK decisions as a plain count, singular vs. plural', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, () => new Date('2026-01-01T01:00:00Z'));
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
  const provider = new WebFilteringDashboardCardProvider(repository, () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.summaryLabel, '2 recent site blocks (1 pending review)');
});

test('excludes a decision older than the recent window, never inflating the count with stale data', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2025-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://old.example/', null, decision({ domain: 'old.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, () => new Date('2026-01-01T00:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.summaryLabel, 'No recent site blocks');
});

test('a family-wide read (childId null) aggregates every child in the family, never leaking into another family', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  await service.record('fam-1', 'prof-2', 'https://b.example/', null, decision({ domain: 'b.example' }));
  await service.record('fam-2', 'prof-9', 'https://c.example/', null, decision({ domain: 'c.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.summaryLabel, '2 recent site blocks');
});

test('a per-child read (childId supplied) narrows the count to that child only', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  await service.record('fam-1', 'prof-2', 'https://b.example/', null, decision({ domain: 'b.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', 'prof-2');
  assert.equal(card.summaryLabel, '1 recent site block');
});

test('the card never carries a domain, url, pageTitle, or reasonCode field -- summary label only, matching DashboardCard\'s own privacy contract', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://secret-site.example/private-path', 'A Private Page Title', decision({ domain: 'secret-site.example' }));
  const provider = new WebFilteringDashboardCardProvider(repository, () => new Date('2026-01-01T01:00:00Z'));
  const card = await provider.getCard('fam-1', null);
  const keys = Object.keys(card).sort();
  assert.deepEqual(keys, ['capabilityState', 'kind', 'lastAcknowledgedPolicyRevision', 'pendingOrOfflineStatus', 'summaryLabel']);
  assert.doesNotMatch(card.summaryLabel, /secret-site|private-path|Private Page Title/);
});
