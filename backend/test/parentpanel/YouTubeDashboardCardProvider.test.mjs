import assert from 'node:assert/strict';
import test from 'node:test';
import { UnavailableModeAUsageEvidenceSource, YouTubeDashboardCardProvider } from '../../dist/parentpanel/YouTubeDashboardCardProvider.js';
import { InMemoryProfileModeRepository, ModeTransitionService } from '../../dist/youtube/ModeTransitionService.js';
import { InMemoryModeBFeatureFlagRepository } from '../../dist/youtube/ModeBFeatureFlagStore.js';
import { ModeAUsageReportService } from '../../dist/youtube/ModeAUsageReportService.js';

function buildTransitionService() {
  return new ModeTransitionService(new InMemoryProfileModeRepository(), new InMemoryModeBFeatureFlagRepository());
}

test('kind is YOUTUBE', () => {
  const provider = new YouTubeDashboardCardProvider(buildTransitionService(), new ModeAUsageReportService());
  assert.equal(provider.kind, 'YOUTUBE');
});

test('a family-wide read (childId null) cannot report one aggregate mode across children -- honestly LIMITED, never a fabricated cross-child summary', async () => {
  const provider = new YouTubeDashboardCardProvider(buildTransitionService(), new ModeAUsageReportService());
  const card = await provider.getCard('fam-1', null);
  assert.equal(card.kind, 'YOUTUBE');
  assert.equal(card.capabilityState, 'LIMITED');
  assert.equal(card.summaryLabel, null);
  assert.equal(card.lastAcknowledgedPolicyRevision, null);
  assert.equal(card.pendingOrOfflineStatus, 'NONE');
});

test('a per-child read with no wired usage-evidence source honestly reports UNAVAILABLE, never a fabricated duration', async () => {
  const provider = new YouTubeDashboardCardProvider(buildTransitionService(), new ModeAUsageReportService());
  const card = await provider.getCard('fam-1', 'prof-1');
  assert.equal(card.capabilityState, 'UNAVAILABLE');
  assert.equal(card.summaryLabel, null);
});

test('UnavailableModeAUsageEvidenceSource is the honest default -- reports UNSUPPORTED/null, matching this codebase\'s Unavailable* stub convention', async () => {
  const source = new UnavailableModeAUsageEvidenceSource();
  const usage = await source.getCurrentUsage('fam-1', 'prof-1');
  assert.deepEqual(usage, { source: 'UNAVAILABLE', capabilityStatus: 'UNSUPPORTED', durationMs: null });
});

test('a granted usage source with a duration figure produces an "app usage only" labeled summary', async () => {
  const usageSource = {
    async getCurrentUsage() {
      return { source: 'ANDROID_USAGE_STATS', capabilityStatus: 'GRANTED', durationMs: 90_000 };
    },
  };
  const provider = new YouTubeDashboardCardProvider(buildTransitionService(), new ModeAUsageReportService(), usageSource);
  const card = await provider.getCard('fam-1', 'prof-1');
  assert.equal(card.capabilityState, 'AVAILABLE');
  assert.equal(card.summaryLabel, '2m (app usage only)');
});

test('a revoked usage capability maps to PERMISSION_REQUIRED, never a silent zero', async () => {
  const usageSource = {
    async getCurrentUsage() {
      return { source: 'UNAVAILABLE', capabilityStatus: 'REVOKED', durationMs: null };
    },
  };
  const provider = new YouTubeDashboardCardProvider(buildTransitionService(), new ModeAUsageReportService(), usageSource);
  const card = await provider.getCard('fam-1', 'prof-1');
  assert.equal(card.capabilityState, 'PERMISSION_REQUIRED');
  assert.equal(card.summaryLabel, null);
});

test('a profile in Mode B reports current mode state only -- AVAILABLE with a plain "Mode B" label, and never consults the Mode A usage-evidence source (Mode B usage/playback summarization stays out of scope)', async () => {
  const flags = new InMemoryModeBFeatureFlagRepository();
  await flags.put({ enabled: true, termsReviewedAt: new Date('2026-01-01T00:00:00Z') });
  const transitionService = new ModeTransitionService(new InMemoryProfileModeRepository(), flags);
  await transitionService.transitionTo('fam-1', 'prof-1', 'B');

  let usageSourceCalled = false;
  const usageSource = {
    async getCurrentUsage() {
      usageSourceCalled = true;
      return { source: 'ANDROID_USAGE_STATS', capabilityStatus: 'GRANTED', durationMs: 60_000 };
    },
  };
  const provider = new YouTubeDashboardCardProvider(transitionService, new ModeAUsageReportService(), usageSource);
  const card = await provider.getCard('fam-1', 'prof-1');
  assert.equal(card.capabilityState, 'AVAILABLE');
  assert.equal(card.summaryLabel, 'Mode B');
  assert.equal(usageSourceCalled, false);
});

test('the card never carries a video id, title, channel, or watch-list field -- current mode/usage-summary only', async () => {
  const usageSource = {
    async getCurrentUsage() {
      return { source: 'ANDROID_USAGE_STATS', capabilityStatus: 'GRANTED', durationMs: 30_000 };
    },
  };
  const provider = new YouTubeDashboardCardProvider(buildTransitionService(), new ModeAUsageReportService(), usageSource);
  const card = await provider.getCard('fam-1', 'prof-1');
  const keys = Object.keys(card).sort();
  assert.deepEqual(keys, ['capabilityState', 'kind', 'lastAcknowledgedPolicyRevision', 'pendingOrOfflineStatus', 'summaryLabel']);
});
