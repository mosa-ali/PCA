import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEnvelope } from '../../dist/familyenvelope/FamilyEnvelopeVerifier.js';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import {
  createTestOnlyEnvelopeSignatureVerifier,
  signTestOnlyEnvelope,
} from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

const SENDER_PUBLIC_KEY = 'sender-public-key-1';

function buildEnvelope(overrides = {}) {
  const unsigned = {
    protocolVersion: 1,
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    senderKeyId: 'key-1',
    messageType: 'POLICY_PUSH',
    sequenceOrNonce: 'seq-1',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    dataVersion: 1,
    trustSetEpoch: 1,
    keyEpoch: 1,
    payload: Buffer.from('hello'),
    ...overrides,
  };
  const signature = signTestOnlyEnvelope(SENDER_PUBLIC_KEY, canonicalizeEnvelope(unsigned));
  return { ...unsigned, signature };
}

function buildHarness() {
  return {
    verifier: createTestOnlyEnvelopeSignatureVerifier(),
    replayLedger: new InMemoryReplayLedger(),
    versionLedger: new InMemoryDataVersionLedger(),
  };
}

function baseContext(overrides = {}) {
  return {
    senderPublicKey: SENDER_PUBLIC_KEY,
    minimumAcceptedTrustSetEpoch: 0,
    minimumAcceptedKeyEpoch: 0,
    now: new Date('2026-01-01T00:30:00.000Z'),
    ...overrides,
  };
}

test('a valid envelope is accepted', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const verdict = await evaluateEnvelope(buildEnvelope(), baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: true });
});

test('an expired envelope is rejected as EXPIRED, even with a valid signature', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope();
  const context = baseContext({ now: new Date('2026-01-01T02:00:00.000Z') });
  const verdict = await evaluateEnvelope(envelope, context, verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: false, reason: 'EXPIRED' });
});

test('an envelope below the receiver\'s minimum accepted trustSetEpoch is rejected', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope({ trustSetEpoch: 1 });
  const context = baseContext({ minimumAcceptedTrustSetEpoch: 2 });
  const verdict = await evaluateEnvelope(envelope, context, verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: false, reason: 'STALE_TRUST_SET_EPOCH' });
});

test('an envelope below the receiver\'s minimum accepted keyEpoch is rejected', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope({ keyEpoch: 1 });
  const context = baseContext({ minimumAcceptedKeyEpoch: 2 });
  const verdict = await evaluateEnvelope(envelope, context, verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: false, reason: 'STALE_KEY_EPOCH' });
});

test('a tampered field invalidates the signature -- metadata cannot be altered without detection', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope();
  const tampered = { ...envelope, trustSetEpoch: 999 }; // signature no longer matches canonical bytes
  const verdict = await evaluateEnvelope(tampered, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
});

test('a replayed sequence/nonce is rejected on the second delivery, even though the signature is still genuinely valid', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope();
  const first = await evaluateEnvelope(envelope, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(first, { accepted: true });
  const second = await evaluateEnvelope(envelope, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(second, { accepted: false, reason: 'REPLAYED' });
});

test('a non-monotonic dataVersion is rejected for an ordinary (non-ROLLBACK) message', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'seq-1', dataVersion: 5 });
  await evaluateEnvelope(first, baseContext(), verifier, replayLedger, versionLedger);

  const equalVersion = buildEnvelope({ sequenceOrNonce: 'seq-2', dataVersion: 5 });
  const equalVerdict = await evaluateEnvelope(equalVersion, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(equalVerdict, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });

  const lowerVersion = buildEnvelope({ sequenceOrNonce: 'seq-3', dataVersion: 4 });
  const lowerVerdict = await evaluateEnvelope(lowerVersion, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(lowerVerdict, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });
});

test('a higher dataVersion for an ordinary message is accepted and advances the ledger', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'seq-1', dataVersion: 5 });
  await evaluateEnvelope(first, baseContext(), verifier, replayLedger, versionLedger);

  const higher = buildEnvelope({ sequenceOrNonce: 'seq-2', dataVersion: 6 });
  const verdict = await evaluateEnvelope(higher, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: true });
});

test('an explicitly signed ROLLBACK message is exempt from version monotonicity', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'seq-1', dataVersion: 5 });
  await evaluateEnvelope(first, baseContext(), verifier, replayLedger, versionLedger);

  const rollback = buildEnvelope({ sequenceOrNonce: 'seq-2', dataVersion: 2, messageType: 'ROLLBACK' });
  const verdict = await evaluateEnvelope(rollback, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: true });

  // The rollback's target version becomes the new floor for subsequent ordinary messages.
  const equalToRollback = buildEnvelope({ sequenceOrNonce: 'seq-3', dataVersion: 2 });
  const rejected = await evaluateEnvelope(equalToRollback, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(rejected, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });

  // The real proof the floor actually moved DOWN, not just "still rejects
  // the exact rollback target": an intermediate version (3) sits between
  // the rollback target (2) and the stale pre-rollback floor (5) -- it
  // must be accepted, which is only possible if the floor is genuinely 2,
  // not still 5.
  const postRollbackVersion = buildEnvelope({ sequenceOrNonce: 'seq-4', dataVersion: 3 });
  const accepted = await evaluateEnvelope(postRollbackVersion, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(accepted, { accepted: true });
});

test('a rejected envelope never advances the replay ledger -- a corrected legitimate resubmission with the same sequence/nonce can still succeed', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const expiredAttempt = buildEnvelope({ sequenceOrNonce: 'seq-1' });
  const expiredVerdict = await evaluateEnvelope(
    expiredAttempt,
    baseContext({ now: new Date('2026-01-01T02:00:00.000Z') }), // forces EXPIRED
    verifier,
    replayLedger,
    versionLedger,
  );
  assert.deepEqual(expiredVerdict, { accepted: false, reason: 'EXPIRED' });

  // Same sequenceOrNonce, but now evaluated before expiry -- must still succeed.
  const resubmission = buildEnvelope({ sequenceOrNonce: 'seq-1' });
  const verdict = await evaluateEnvelope(resubmission, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: true });
});

test('a rejected (invalid-signature) envelope never advances the data-version ledger', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const forged = { ...buildEnvelope({ sequenceOrNonce: 'seq-1', dataVersion: 10 }), signature: 'not-a-real-signature' };
  const forgedVerdict = await evaluateEnvelope(forged, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(forgedVerdict, { accepted: false, reason: 'INVALID_SIGNATURE' });

  // A genuine, lower-numbered envelope must still be accepted as version 1 -- proving the forged attempt at version 10 never became the floor.
  const genuine = buildEnvelope({ sequenceOrNonce: 'seq-2', dataVersion: 1 });
  const verdict = await evaluateEnvelope(genuine, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: true });
});

test('a STALE_TRUST_SET_EPOCH rejection never advances the replay ledger', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: 'seq-1', trustSetEpoch: 1 });
  const staleVerdict = await evaluateEnvelope(
    envelope,
    baseContext({ minimumAcceptedTrustSetEpoch: 2 }),
    verifier,
    replayLedger,
    versionLedger,
  );
  assert.deepEqual(staleVerdict, { accepted: false, reason: 'STALE_TRUST_SET_EPOCH' });
  assert.equal(replayLedger.hasProcessed(envelope.senderKeyId, envelope.sequenceOrNonce), false);

  // The same sequenceOrNonce, now evaluated against a floor it satisfies, must still succeed.
  const verdict = await evaluateEnvelope(envelope, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(verdict, { accepted: true });
});

test('a REPLAYED rejection never advances the data-version ledger', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'seq-1', dataVersion: 5 });
  await evaluateEnvelope(first, baseContext(), verifier, replayLedger, versionLedger);

  // Same sequenceOrNonce, higher dataVersion -- REPLAYED must win over what would otherwise be a monotonic version bump.
  const replay = buildEnvelope({ sequenceOrNonce: 'seq-1', dataVersion: 99 });
  const replayVerdict = await evaluateEnvelope(replay, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(replayVerdict, { accepted: false, reason: 'REPLAYED' });
  assert.equal(versionLedger.getLastAcceptedVersion(first.senderKeyId), 5, 'the replayed envelope\'s dataVersion of 99 must never have been recorded');
});

test('a VERSION_NOT_MONOTONIC rejection never advances the replay ledger', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'seq-1', dataVersion: 5 });
  await evaluateEnvelope(first, baseContext(), verifier, replayLedger, versionLedger);

  const nonMonotonic = buildEnvelope({ sequenceOrNonce: 'seq-2', dataVersion: 3 });
  const rejected = await evaluateEnvelope(nonMonotonic, baseContext(), verifier, replayLedger, versionLedger);
  assert.deepEqual(rejected, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });
  assert.equal(replayLedger.hasProcessed(nonMonotonic.senderKeyId, 'seq-2'), false);
});

test('expiry is boundary-inclusive: now exactly equal to expiresAt is rejected', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope();
  const verdict = await evaluateEnvelope(
    envelope,
    baseContext({ now: envelope.expiresAt }),
    verifier,
    replayLedger,
    versionLedger,
  );
  assert.deepEqual(verdict, { accepted: false, reason: 'EXPIRED' });
});

test('epoch floors are boundary-inclusive: an envelope exactly at the minimum accepted epoch is accepted', async () => {
  const { verifier, replayLedger, versionLedger } = buildHarness();
  const envelope = buildEnvelope({ trustSetEpoch: 2, keyEpoch: 3 });
  const verdict = await evaluateEnvelope(
    envelope,
    baseContext({ minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 3 }),
    verifier,
    replayLedger,
    versionLedger,
  );
  assert.deepEqual(verdict, { accepted: true });
});
