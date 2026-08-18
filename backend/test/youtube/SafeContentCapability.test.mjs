import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultYouTubeSafeContentCapability,
  isPlausibleYouTubeSafeContentCapability,
} from '../../dist/youtube/policy.js';

test('PCA-FR-053 defaults native YouTube safe-content capability to explicit unsupported', () => {
  assert.deepEqual(defaultYouTubeSafeContentCapability(), {
    status: 'UNSUPPORTED',
    source: 'UNAVAILABLE',
  });
});

test('PCA-FR-053 accepts enabled or disabled only from a Restricted Mode signal source', () => {
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'ENABLED', source: 'YOUTUBE_RESTRICTED_MODE' }), true);
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'DISABLED', source: 'YOUTUBE_RESTRICTED_MODE' }), true);
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'ENABLED', source: 'UNAVAILABLE' }), false);
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'DISABLED', source: 'UNAVAILABLE' }), false);
});

test('PCA-FR-053 preserves unknown/unavailable without turning it into a safety claim', () => {
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'UNKNOWN', source: 'UNAVAILABLE' }), true);
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'UNSUPPORTED', source: 'UNAVAILABLE' }), true);
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'UNKNOWN', source: 'YOUTUBE_RESTRICTED_MODE' }), false);
  assert.equal(isPlausibleYouTubeSafeContentCapability({ status: 'ENABLED', source: 'OTHER' }), false);
});
