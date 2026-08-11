import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardAggregatorService } from '../../dist/parentpanel/DashboardAggregatorService.js';

function provider(kind, card, shouldThrow = false) {
  return {
    kind,
    async getCard() {
      if (shouldThrow) throw new Error('provider failure');
      return card;
    },
  };
}

test('getDashboard returns a card per registered provider for a FULL_FAMILY scope', async () => {
  const aggregator = new DashboardAggregatorService([
    provider('SCREEN_TIME', { kind: 'SCREEN_TIME', capabilityState: 'AVAILABLE', lastAcknowledgedPolicyRevision: 1, pendingOrOfflineStatus: 'NONE', summaryLabel: 'ok' }),
    provider('WEB_FILTERING', { kind: 'WEB_FILTERING', capabilityState: 'LIMITED', lastAcknowledgedPolicyRevision: 2, pendingOrOfflineStatus: 'NONE', summaryLabel: 'partial' }),
  ]);
  const cards = await aggregator.getDashboard('fam-1', { kind: 'FULL_FAMILY' });
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.kind).sort(), ['SCREEN_TIME', 'WEB_FILTERING']);
});

test('a throwing provider becomes an isolated UNAVAILABLE card, never aborts the whole dashboard', async () => {
  const aggregator = new DashboardAggregatorService([
    provider('SCREEN_TIME', { kind: 'SCREEN_TIME', capabilityState: 'AVAILABLE', lastAcknowledgedPolicyRevision: 1, pendingOrOfflineStatus: 'NONE', summaryLabel: 'ok' }),
    provider('WEB_FILTERING', null, true),
  ]);
  const cards = await aggregator.getDashboard('fam-1', { kind: 'FULL_FAMILY' });
  assert.equal(cards.length, 2);
  const webFiltering = cards.find((c) => c.kind === 'WEB_FILTERING');
  assert.equal(webFiltering.capabilityState, 'UNAVAILABLE');
  const screenTime = cards.find((c) => c.kind === 'SCREEN_TIME');
  assert.equal(screenTime.capabilityState, 'AVAILABLE');
});

test('a card is never reported AVAILABLE just because a provider is registered -- the provider\'s own state is honored, not overridden', async () => {
  const aggregator = new DashboardAggregatorService([
    provider('LOCATION', { kind: 'LOCATION', capabilityState: 'PERMISSION_REQUIRED', lastAcknowledgedPolicyRevision: null, pendingOrOfflineStatus: 'NONE', summaryLabel: null }),
  ]);
  const cards = await aggregator.getDashboard('fam-1', { kind: 'FULL_FAMILY' });
  assert.equal(cards[0].capabilityState, 'PERMISSION_REQUIRED');
});

test('an OWN_CHILD_ONLY scope never even requests a parent-administrative card kind', async () => {
  let securityRecoveryCalled = false;
  const aggregator = new DashboardAggregatorService([
    provider('SCREEN_TIME', { kind: 'SCREEN_TIME', capabilityState: 'AVAILABLE', lastAcknowledgedPolicyRevision: 1, pendingOrOfflineStatus: 'NONE', summaryLabel: null }),
    {
      kind: 'SECURITY_RECOVERY',
      async getCard() {
        securityRecoveryCalled = true;
        return { kind: 'SECURITY_RECOVERY', capabilityState: 'AVAILABLE', lastAcknowledgedPolicyRevision: null, pendingOrOfflineStatus: 'NONE', summaryLabel: null };
      },
    },
  ]);
  const cards = await aggregator.getDashboard('fam-1', { kind: 'OWN_CHILD_ONLY', childId: 'child-1' });
  assert.equal(cards.some((c) => c.kind === 'SECURITY_RECOVERY'), false);
  assert.equal(securityRecoveryCalled, false);
  assert.equal(cards.some((c) => c.kind === 'SCREEN_TIME'), true);
});

test('a missing provider for a requested kind resolves to UNAVAILABLE, never throws', async () => {
  const aggregator = new DashboardAggregatorService([]);
  const cards = await aggregator.getDashboard('fam-1', { kind: 'FULL_FAMILY' });
  assert.deepEqual(cards, []);
});
