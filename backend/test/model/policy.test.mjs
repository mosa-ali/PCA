import assert from 'node:assert/strict';
import test from 'node:test';
import {
  declaresProhibitedUse,
  isLegalModelLifecycleTransition,
  isPermittedInputSurface,
  isPlatformAndRuntimeCompatible,
  isStructurallyPlausibleMetadata,
  isTerminalLifecycleState,
} from '../../dist/model/policy.js';

function metadata(overrides = {}) {
  return {
    modelId: 'model-1',
    releaseId: 'MODEL_PACKAGE:SHARED:1.0.0',
    version: '1.0.0',
    formatRuntimeCompatibility: ['LITERT_ANDROID'],
    targetPlatform: 'ANDROID',
    supportedLocales: ['en', 'ar'],
    purpose: 'phishing/scam supplementary signal',
    inScopeInputSurfaces: ['PHISHING_SCAM_SUPPLEMENTARY_SIGNAL'],
    prohibitedUses: ['face identity recognition'],
    sourceLicenseProvenanceRef: 'ref://provenance/1',
    datasetRightsAndChildDataExclusionRef: 'ref://dataset/1',
    targetLabels: ['PHISHING'],
    calibrationThresholdVersion: 'cal-1',
    expectedLatencyMs: 100,
    expectedMemoryBytes: 1024,
    falsePositiveNegativeEvidenceRef: 'ref://eval/1',
    privacyImpactReviewRef: 'ref://privacy/1',
    biasSafetyReviewRef: 'ref://bias/1',
    redTeamFindingsRef: 'ref://redteam/1',
    residualRiskAccepted: true,
    releaseChannel: 'PRODUCTION',
    rolloutPercentage: 100,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    rollbackTargetModelId: null,
    killSwitchSupported: true,
    ...overrides,
  };
}

test('isPermittedInputSurface allows only the three doc-permitted surfaces', () => {
  assert.equal(isPermittedInputSurface('SAFE_BROWSER_CATEGORY_RISK_SCORING'), true);
  assert.equal(isPermittedInputSurface('PHISHING_SCAM_SUPPLEMENTARY_SIGNAL'), true);
  assert.equal(isPermittedInputSurface('EYE_DISTANCE_CALIBRATION'), true);
  assert.equal(isPermittedInputSurface('FACE_IDENTITY_RECOGNITION'), false);
  assert.equal(isPermittedInputSurface('EMOTION_INFERENCE'), false);
});

test('declaresProhibitedUse flags prohibited terms in purpose or prohibitedUses text', () => {
  assert.equal(declaresProhibitedUse(metadata({ purpose: 'face identity recognition helper' })), true);
  assert.equal(declaresProhibitedUse(metadata({ prohibitedUses: ['emotion inference'] })), true);
  assert.equal(declaresProhibitedUse(metadata({ purpose: 'phishing/scam supplementary signal', prohibitedUses: [] })), false);
});

test('isStructurallyPlausibleMetadata accepts well-formed metadata', () => {
  assert.equal(isStructurallyPlausibleMetadata(metadata()), true);
});

test('isStructurallyPlausibleMetadata rejects an empty inScopeInputSurfaces list', () => {
  assert.equal(isStructurallyPlausibleMetadata(metadata({ inScopeInputSurfaces: [] })), false);
});

test('isStructurallyPlausibleMetadata rejects a non-permitted surface even if otherwise well-formed', () => {
  assert.equal(isStructurallyPlausibleMetadata(metadata({ inScopeInputSurfaces: ['FACE_IDENTITY_RECOGNITION'] })), false);
});

test('isStructurallyPlausibleMetadata rejects an out-of-range rollout percentage', () => {
  assert.equal(isStructurallyPlausibleMetadata(metadata({ rolloutPercentage: 150 })), false);
  assert.equal(isStructurallyPlausibleMetadata(metadata({ rolloutPercentage: -1 })), false);
});

test('isStructurallyPlausibleMetadata rejects oversized metadata (too many prohibited-use entries)', () => {
  assert.equal(isStructurallyPlausibleMetadata(metadata({ prohibitedUses: Array(50).fill('x') })), false);
});

test('isPlatformAndRuntimeCompatible: ANDROID target matches ANDROID device, not IOS', () => {
  const m = metadata({ targetPlatform: 'ANDROID', formatRuntimeCompatibility: ['LITERT_ANDROID'] });
  assert.deepEqual(isPlatformAndRuntimeCompatible(m, { platform: 'ANDROID', supportedFormats: ['LITERT_ANDROID'] }), { platformOk: true, runtimeOk: true });
  assert.deepEqual(isPlatformAndRuntimeCompatible(m, { platform: 'IOS', supportedFormats: ['COREML_IOS'] }), { platformOk: false, runtimeOk: false });
});

test('isPlatformAndRuntimeCompatible: SHARED target is platform-agnostic but still runtime-checked', () => {
  const m = metadata({ targetPlatform: 'SHARED', formatRuntimeCompatibility: ['LITERT_ANDROID'] });
  assert.deepEqual(isPlatformAndRuntimeCompatible(m, { platform: 'IOS', supportedFormats: ['COREML_IOS'] }), { platformOk: true, runtimeOk: false });
});

test('lifecycle transitions: the full happy path is legal in order', () => {
  const path = ['DISCOVERED', 'DOWNLOADED', 'VERIFYING', 'VERIFIED', 'STAGED', 'ACTIVE'];
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(isLegalModelLifecycleTransition(path[i], path[i + 1]), true, `${path[i]} -> ${path[i + 1]}`);
  }
});

test('lifecycle transitions: ACTIVE cannot be reached directly from VERIFIED, skipping STAGED', () => {
  assert.equal(isLegalModelLifecycleTransition('VERIFIED', 'ACTIVE'), false);
});

test('lifecycle transitions: every terminal state has no outgoing transition', () => {
  for (const state of ['ROLLED_BACK', 'REJECTED', 'EXPIRED', 'DISABLED']) {
    assert.equal(isTerminalLifecycleState(state), true);
    for (const to of ['DISCOVERED', 'DOWNLOADED', 'VERIFYING', 'VERIFIED', 'STAGED', 'ACTIVE', 'ROLLED_BACK', 'REJECTED', 'EXPIRED', 'DISABLED']) {
      assert.equal(isLegalModelLifecycleTransition(state, to), false, `${state} -> ${to} must be illegal`);
    }
  }
});
