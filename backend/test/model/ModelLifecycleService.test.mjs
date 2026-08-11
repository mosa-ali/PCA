import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryModelLifecycleRepository } from '../../dist/model/ModelLifecycleRepository.js';
import { ModelLifecycleError, ModelLifecycleService } from '../../dist/model/ModelLifecycleService.js';
import { PackageVerificationGate } from '../../dist/model/PackageVerificationGate.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const GOOD_DIGEST = 'a'.repeat(64);
const DEVICE = { platform: 'ANDROID', supportedFormats: ['LITERT_ANDROID'] };

function metadata(overrides = {}) {
  return {
    modelId: overrides.modelId ?? 'model-1',
    releaseId: 'MODEL_PACKAGE:SHARED:1.0.0',
    version: '1.0.0',
    formatRuntimeCompatibility: ['LITERT_ANDROID'],
    targetPlatform: 'ANDROID',
    supportedLocales: ['en'],
    purpose: 'phishing/scam supplementary signal',
    inScopeInputSurfaces: ['PHISHING_SCAM_SUPPLEMENTARY_SIGNAL'],
    prohibitedUses: [],
    sourceLicenseProvenanceRef: 'ref://p/1',
    datasetRightsAndChildDataExclusionRef: 'ref://d/1',
    targetLabels: ['PHISHING'],
    calibrationThresholdVersion: 'cal-1',
    expectedLatencyMs: 100,
    expectedMemoryBytes: 1024,
    falsePositiveNegativeEvidenceRef: 'ref://e/1',
    privacyImpactReviewRef: 'ref://pr/1',
    biasSafetyReviewRef: 'ref://b/1',
    redTeamFindingsRef: 'ref://rt/1',
    residualRiskAccepted: true,
    releaseChannel: 'PRODUCTION',
    rolloutPercentage: 100,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    rollbackTargetModelId: null,
    killSwitchSupported: true,
    ...overrides,
  };
}

function release(overrides = {}) {
  return {
    releaseId: 'MODEL_PACKAGE:SHARED:1.0.0',
    packageType: 'MODEL_PACKAGE',
    platform: 'SHARED',
    version: '1.0.0',
    artifactDigest: GOOD_DIGEST,
    artifactSizeBytes: 1024,
    signingKeyId: 'key-1',
    signedMetadata: Buffer.from('x'),
    minimumSupportedVersion: null,
    state: 'PUBLISHED',
    publishedAt: NOW,
    retiredAt: null,
    ...overrides,
  };
}

function gate({ signatureOk = true, selfTestOk = true } = {}) {
  return new PackageVerificationGate({ verifySignature: async () => signatureOk }, { runSelfTest: async () => selfTestOk }, () => NOW);
}

function makeService({ directiveSignatureOk = true } = {}) {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(
    repo,
    { verify: async () => directiveSignatureOk },
    new InMemoryActionIdempotencyLedger(),
    () => NOW,
  );
  return { repo, service };
}

function emergencyDirective(overrides = {}) {
  return { directiveId: 'directive-1', action: 'ROLLBACK', modelId: null, rollbackToModelId: null, issuedAt: NOW, signature: 'sig', ...overrides };
}

async function toActive(service, modelId = 'model-1', overrides = {}) {
  await service.registerDiscovered(metadata({ modelId, ...overrides }));
  await service.markDownloaded(modelId);
  await service.beginVerification(modelId);
  await service.completeVerification(modelId, gate(), release(), GOOD_DIGEST, DEVICE);
  await service.stage(modelId);
  return service.activate(modelId);
}

test('a model must not become ACTIVE until all verification gates pass -- happy path reaches ACTIVE and sets the active pointer', async () => {
  const { service } = makeService();
  const active = await toActive(service);
  assert.equal(active.state, 'ACTIVE');
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), 'model-1');
});

test('activate() is rejected from any state other than STAGED (e.g. straight from VERIFIED)', async () => {
  const { service } = makeService();
  await service.registerDiscovered(metadata());
  await service.markDownloaded('model-1');
  await service.beginVerification('model-1');
  await service.completeVerification('model-1', gate(), release(), GOOD_DIGEST, DEVICE);
  await assert.rejects(() => service.activate('model-1'), ModelLifecycleError);
});

test('a FAILED verification transitions only the candidate to REJECTED and never touches the active pointer', async () => {
  const { service } = makeService();
  await toActive(service, 'model-good');

  await service.registerDiscovered(metadata({ modelId: 'model-bad' }));
  await service.markDownloaded('model-bad');
  await service.beginVerification('model-bad');
  const rejected = await service.completeVerification('model-bad', gate({ signatureOk: false }), release(), GOOD_DIGEST, DEVICE);

  assert.equal(rejected.state, 'REJECTED');
  assert.equal(rejected.lastVerificationFailureReason, 'BAD_SIGNATURE');
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), 'model-good');
});

test('rollback moves the active pointer to a previously known-good target and marks the old one ROLLED_BACK, given a validly signed directive', async () => {
  const { service } = makeService();

  await service.registerDiscovered(metadata({ modelId: 'model-v1' }));
  await service.markDownloaded('model-v1');
  await service.beginVerification('model-v1');
  await service.completeVerification('model-v1', gate(), release({ releaseId: 'r1' }), GOOD_DIGEST, DEVICE);
  await service.stage('model-v1'); // model-v1 now VERIFIED->STAGED, a known-good rollback target

  await toActive(service, 'model-v2');
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), 'model-v2');

  const { rolledBack, newActive } = await service.rollback(emergencyDirective({ modelId: 'model-v2', rollbackToModelId: 'model-v1' }));
  assert.equal(rolledBack.state, 'ROLLED_BACK');
  assert.equal(newActive.state, 'ACTIVE');
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), 'model-v1');
});

test('rollback attack: an UNSIGNED (signature-invalid) directive is rejected and never moves the active pointer', async () => {
  const { service } = makeService({ directiveSignatureOk: false });
  await toActive(service, 'model-v2');
  await service.registerDiscovered(metadata({ modelId: 'model-v1' }));

  await assert.rejects(
    () => service.rollback(emergencyDirective({ modelId: 'model-v2', rollbackToModelId: 'model-v1' })),
    (err) => err instanceof ModelLifecycleError && err.code === 'DIRECTIVE_SIGNATURE_INVALID',
  );
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), 'model-v2');
});

test('rollback attack: a replayed directiveId does not re-execute the transition, but idempotently returns the prior state', async () => {
  const { service } = makeService();

  await service.registerDiscovered(metadata({ modelId: 'model-v1' }));
  await service.markDownloaded('model-v1');
  await service.beginVerification('model-v1');
  await service.completeVerification('model-v1', gate(), release({ releaseId: 'r1' }), GOOD_DIGEST, DEVICE);
  await service.stage('model-v1');
  await toActive(service, 'model-v2');

  const directive = emergencyDirective({ modelId: 'model-v2', rollbackToModelId: 'model-v1' });
  const first = await service.rollback(directive);
  const replay = await service.rollback(directive);
  assert.equal(replay.rolledBack.state, first.rolledBack.state);
  assert.equal(replay.newActive.modelId, first.newActive.modelId);
});

test('rollback rejects a target that was never verified (a lower/unverified artifact)', async () => {
  const { service } = makeService();
  await toActive(service, 'model-v2');

  await service.registerDiscovered(metadata({ modelId: 'model-unverified' })); // still DISCOVERED, never verified
  await assert.rejects(
    () => service.rollback(emergencyDirective({ modelId: 'model-v2', rollbackToModelId: 'model-unverified' })),
    (err) => err instanceof ModelLifecycleError && err.code === 'ROLLBACK_TARGET_NOT_KNOWN_GOOD',
  );
});

test('rollback rejects a nonexistent target', async () => {
  const { service } = makeService();
  await toActive(service, 'model-v2');
  await assert.rejects(
    () => service.rollback(emergencyDirective({ modelId: 'model-v2', rollbackToModelId: 'does-not-exist' })),
    (err) => err instanceof ModelLifecycleError && err.code === 'ROLLBACK_TARGET_NOT_FOUND',
  );
});

test('rollback rejects a directive whose action is DISABLE, not ROLLBACK (directive/operation mismatch)', async () => {
  const { service } = makeService();
  await toActive(service, 'model-v2');
  await assert.rejects(
    () => service.rollback(emergencyDirective({ action: 'DISABLE', modelId: 'model-v2', rollbackToModelId: 'model-v1' })),
    (err) => err instanceof ModelLifecycleError && err.code === 'DIRECTIVE_WRONG_ACTION',
  );
});

test('the kill switch disables an ACTIVE model, clears the active pointer, and never silently restores it -- given a validly signed directive', async () => {
  const { service } = makeService();
  await toActive(service, 'model-1');

  const disabled = await service.disable(emergencyDirective({ action: 'DISABLE', modelId: 'model-1' }));
  assert.equal(disabled.state, 'DISABLED');
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), null);

  // DISABLED is terminal -- no transition, including back to ACTIVE, is legal for this record.
  await assert.rejects(() => service.stage('model-1'), ModelLifecycleError);
});

test('kill-switch bypass attempt: an unsigned directive cannot disable a model, and inference-affecting state is untouched', async () => {
  const { service } = makeService({ directiveSignatureOk: false });
  await toActive(service, 'model-1');
  await assert.rejects(
    () => service.disable(emergencyDirective({ action: 'DISABLE', modelId: 'model-1' })),
    (err) => err instanceof ModelLifecycleError && err.code === 'DIRECTIVE_SIGNATURE_INVALID',
  );
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), 'model-1');
});

test('the kill switch can only disable a currently ACTIVE model', async () => {
  const { service } = makeService();
  await service.registerDiscovered(metadata());
  await assert.rejects(
    () => service.disable(emergencyDirective({ action: 'DISABLE', modelId: 'model-1' })),
    (err) => err instanceof ModelLifecycleError && err.code === 'KILL_SWITCH_NOT_APPLICABLE',
  );
});

test('expireIfPast transitions an active model to EXPIRED once past its own expiry and clears the active pointer', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  let clock = NOW;
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => clock);
  await toActive(service, 'model-1', { expiresAt: new Date(NOW.getTime() + 1000) });

  clock = new Date(NOW.getTime() + 5000);
  const expired = await service.expireIfPast('model-1');
  assert.equal(expired.state, 'EXPIRED');
  assert.equal(await service.getActiveModelId('phishing/scam supplementary signal'), null);
});

test('expireIfPast is a no-op before the expiry instant', async () => {
  const { service } = makeService();
  const active = await toActive(service, 'model-1');
  const result = await service.expireIfPast('model-1');
  assert.deepEqual(result, active);
});

test('an illegal transition (e.g. DISCOVERED straight to ACTIVE) is rejected', async () => {
  const { service } = makeService();
  await service.registerDiscovered(metadata());
  await assert.rejects(() => service.activate('model-1'), ModelLifecycleError);
});
