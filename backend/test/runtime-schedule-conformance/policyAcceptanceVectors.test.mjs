import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluatePolicyAcceptance, isAcceptableRevision } from './policyAcceptanceReference.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsPath = path.join(here, '..', '..', '..', 'contracts', 'schedule-runtime', 'vectors', 'policy-acceptance-v1.json');
const doc = JSON.parse(readFileSync(vectorsPath, 'utf8'));

function reviveDate(value) {
  return value === null || value === undefined ? null : new Date(value);
}

function resolveExpectedEffectivePolicy(tag, vectorInput) {
  if (tag === null) return null;
  if (tag === 'candidate') return vectorInput.candidatePolicy;
  if (tag === 'lastKnownGood') return vectorInput.lastKnownGoodPolicy;
  throw new Error(`unknown effectivePolicy tag: ${tag}`);
}

for (const vector of doc.policyAcceptanceVectors) {
  test(`policy-acceptance vector: ${vector.id}`, () => {
    const input = vector.input;
    const result = evaluatePolicyAcceptance({
      candidatePolicy: input.candidatePolicy,
      lastKnownGoodPolicy: input.lastKnownGoodPolicy,
      nowUtc: reviveDate(input.nowUtc),
      deviceTrustSetEpoch: input.deviceTrustSetEpoch,
      deviceKeyEpoch: input.deviceKeyEpoch,
      connectivity: input.connectivity,
      lastPolicySyncAtUtc: reviveDate(input.lastPolicySyncAtUtc),
      remoteStalenessThresholdMillis: doc.remoteStalenessThresholdMillis,
    });

    assert.equal(result.state, vector.expected.state, `state mismatch for ${vector.id}`);
    assert.deepEqual(
      result.effectivePolicy,
      resolveExpectedEffectivePolicy(vector.expected.effectivePolicy, input),
      `effectivePolicy mismatch for ${vector.id}`,
    );
  });
}

for (const vector of doc.revisionAcceptanceVectors) {
  test(`revision-acceptance vector: ${vector.id}`, () => {
    const acceptable = isAcceptableRevision(vector.input.candidateRevision, vector.input.previouslyAcceptedRevision);
    assert.equal(acceptable, vector.expected.acceptable, `acceptable mismatch for ${vector.id}`);
  });
}
