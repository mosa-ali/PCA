import assert from 'node:assert/strict';
import test from 'node:test';
import { ModeBEventError, ModeBPlaybackEventService, InMemoryModeBPlaybackEventRepository } from '../../dist/youtube/ModeBPlaybackEventService.js';
import { defaultModeBFeatureFlagState } from '../../dist/youtube/policy.js';

const ACTIVE_FLAG = { enabled: true, termsReviewedAt: new Date('2026-01-01T00:00:00Z') };

test('recordEvent rejects any write while the feature flag is inactive (default OFF)', async () => {
  const service = new ModeBPlaybackEventService(new InMemoryModeBPlaybackEventRepository());
  await assert.rejects(
    () =>
      service.recordEvent(defaultModeBFeatureFlagState(), 'fam-1', 'prof-1', {
        videoId: 'abc123',
        eventType: 'PLAYBACK_STARTED',
      }),
    (err) => err instanceof ModeBEventError && err.code === 'FEATURE_DISABLED',
  );
});

test('recordEvent rejects a write when enabled but not terms-reviewed', async () => {
  const service = new ModeBPlaybackEventService(new InMemoryModeBPlaybackEventRepository());
  await assert.rejects(
    () =>
      service.recordEvent({ enabled: true, termsReviewedAt: null }, 'fam-1', 'prof-1', {
        videoId: 'abc123',
        eventType: 'PLAYBACK_STARTED',
      }),
    (err) => err instanceof ModeBEventError && err.code === 'FEATURE_DISABLED',
  );
});

test('recordEvent stores a PLAYBACK_STARTED event when Mode B is fully active', async () => {
  const repo = new InMemoryModeBPlaybackEventRepository();
  const service = new ModeBPlaybackEventService(repo, () => new Date('2026-02-01T00:00:00Z'));
  const event = await service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-1', {
    videoId: 'abc123',
    channelId: 'chan-1',
    title: 'Some Video',
    eventType: 'PLAYBACK_STARTED',
  });
  assert.equal(event.videoId, 'abc123');
  assert.equal(event.eventType, 'PLAYBACK_STARTED');
  const stored = await repo.listForProfile('fam-1', 'prof-1');
  assert.equal(stored.length, 1);
});

test('recordEvent enforces the PLAYBACK_ERROR event boundary requires a recognized error code', async () => {
  const service = new ModeBPlaybackEventService(new InMemoryModeBPlaybackEventRepository());
  await assert.rejects(
    () =>
      service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-1', {
        videoId: 'abc123',
        eventType: 'PLAYBACK_ERROR',
      }),
    (err) => err instanceof ModeBEventError && err.code === 'INVALID_EVENT_SHAPE',
  );
});

test('recordEvent honestly stores an EMBEDDING_DISABLED error result', async () => {
  const repo = new InMemoryModeBPlaybackEventRepository();
  const service = new ModeBPlaybackEventService(repo);
  const event = await service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-1', {
    videoId: 'abc123',
    eventType: 'PLAYBACK_ERROR',
    errorCode: 'EMBEDDING_DISABLED',
  });
  assert.equal(event.errorCode, 'EMBEDDING_DISABLED');
});

test('recordEvent rejects a non-error event type carrying an error code', async () => {
  const service = new ModeBPlaybackEventService(new InMemoryModeBPlaybackEventRepository());
  await assert.rejects(
    () =>
      service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-1', {
        videoId: 'abc123',
        eventType: 'PLAYBACK_STARTED',
        errorCode: 'EMBEDDING_DISABLED',
      }),
    (err) => err instanceof ModeBEventError && err.code === 'INVALID_EVENT_SHAPE',
  );
});

test('recordEvent rejects an implausible videoId', async () => {
  const service = new ModeBPlaybackEventService(new InMemoryModeBPlaybackEventRepository());
  await assert.rejects(
    () => service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-1', { videoId: '', eventType: 'PLAYBACK_STARTED' }),
    (err) => err instanceof ModeBEventError && err.code === 'INVALID_VIDEO_ID',
  );
});

test('recordEvent rejects a negative observed duration', async () => {
  const service = new ModeBPlaybackEventService(new InMemoryModeBPlaybackEventRepository());
  await assert.rejects(
    () =>
      service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-1', {
        videoId: 'abc123',
        eventType: 'PLAYBACK_STATE_OBSERVED',
        observedDurationMs: -5,
      }),
    (err) => err instanceof ModeBEventError && err.code === 'INVALID_DURATION',
  );
});

test('listForProfile never returns another profile\'s events', async () => {
  const repo = new InMemoryModeBPlaybackEventRepository();
  const service = new ModeBPlaybackEventService(repo);
  await service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-1', { videoId: 'v1', eventType: 'PLAYBACK_STARTED' });
  await service.recordEvent(ACTIVE_FLAG, 'fam-1', 'prof-2', { videoId: 'v2', eventType: 'PLAYBACK_STARTED' });
  const events = await repo.listForProfile('fam-1', 'prof-1');
  assert.equal(events.length, 1);
  assert.equal(events[0].videoId, 'v1');
});
