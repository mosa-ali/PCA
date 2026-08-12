import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEnvelope, OUT_OF_ORDER_HOLD_PENDING_IMPLEMENTED } from '../../dist/familyenvelope/FamilyEnvelopeVerifier.js';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import {
  createTestOnlyEnvelopeSignatureVerifier,
  signTestOnlyEnvelope,
} from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

const SENDER_PUBLIC_KEY = 'sender-public-key-1';
let messageCounter = 0;

function buildEnvelope(overrides = {}) {
  messageCounter += 1;
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: `msg-${messageCounter}`,
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-1' },
    senderKeyId: 'key-1',
    messageType: 'POLICY_UPDATE',
    sequenceOrNonce: `seq-${messageCounter}`,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: '1.0.0',
    correlationId: null,
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
    messageIdempotencyLedger: new InMemoryMessageIdempotencyLedger(),
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

async function evaluate(envelope, context, harness) {
  return evaluateEnvelope(
    envelope,
    context,
    harness.verifier,
    harness.replayLedger,
    harness.versionLedger,
    harness.messageIdempotencyLedger,
  );
}

test('a valid POLICY_UPDATE envelope is accepted, not idempotent on first delivery', async () => {
  const harness = buildHarness();
  const verdict = await evaluate(buildEnvelope(), baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('an unsupported protocolMajor is rejected before anything else is checked', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope({ protocolMajor: 99 });
  const verdict = await evaluate(envelope, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'UNSUPPORTED_PROTOCOL_MAJOR' });
});

test('an expired envelope is rejected as EXPIRED, even with a valid signature', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope();
  const context = baseContext({ now: new Date('2026-01-01T02:00:00.000Z') });
  const verdict = await evaluate(envelope, context, harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'EXPIRED' });
});

test('an envelope below the receiver\'s minimum accepted trustSetEpoch is rejected', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope({ trustSetEpoch: 1 });
  const context = baseContext({ minimumAcceptedTrustSetEpoch: 2 });
  const verdict = await evaluate(envelope, context, harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'STALE_TRUST_SET_EPOCH' });
});

test('an envelope below the receiver\'s minimum accepted keyEpoch is rejected', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope({ keyEpoch: 1 });
  const context = baseContext({ minimumAcceptedKeyEpoch: 2 });
  const verdict = await evaluate(envelope, context, harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'STALE_KEY_EPOCH' });
});

test('a tampered field invalidates the signature -- metadata cannot be altered without detection', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope();
  const tampered = { ...envelope, trustSetEpoch: 999 };
  const verdict = await evaluate(tampered, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
});

test('a replayed sequence/nonce under a DIFFERENT messageId is rejected, even with a genuinely valid signature', async () => {
  const harness = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'shared-seq' });
  const firstVerdict = await evaluate(first, baseContext(), harness);
  assert.deepEqual(firstVerdict, { accepted: true, idempotent: false });

  const second = buildEnvelope({ sequenceOrNonce: 'shared-seq' }); // fresh messageId, same sequence/nonce
  const secondVerdict = await evaluate(second, baseContext(), harness);
  assert.deepEqual(secondVerdict, { accepted: false, reason: 'REPLAYED' });
});

test('a genuine retransmission of the SAME messageId with byte-identical content is an idempotent accept, not REPLAYED', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope();
  const first = await evaluate(envelope, baseContext(), harness);
  assert.deepEqual(first, { accepted: true, idempotent: false });

  const second = await evaluate(envelope, baseContext(), harness);
  assert.deepEqual(second, { accepted: true, idempotent: true });
});

test('reusing a messageId with DIFFERENT content is MESSAGE_ID_CONFLICT, never a silent accept', async () => {
  const harness = buildHarness();
  const first = buildEnvelope({ messageId: 'shared-msg-id' });
  await evaluate(first, baseContext(), harness);

  // Same messageId, different payload -- must re-sign since canonical bytes changed.
  const conflicting = buildEnvelope({ messageId: 'shared-msg-id', payload: Buffer.from('different') });
  const verdict = await evaluate(conflicting, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'MESSAGE_ID_CONFLICT' });
});

test('a non-monotonic semanticVersion is rejected for POLICY_UPDATE', async () => {
  const harness = buildHarness();
  const first = buildEnvelope({ semanticVersion: '5.0.0' });
  await evaluate(first, baseContext(), harness);

  const equalVersion = buildEnvelope({ semanticVersion: '5.0.0' });
  const equalVerdict = await evaluate(equalVersion, baseContext(), harness);
  assert.deepEqual(equalVerdict, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });

  const lowerVersion = buildEnvelope({ semanticVersion: '4.0.0' });
  const lowerVerdict = await evaluate(lowerVersion, baseContext(), harness);
  assert.deepEqual(lowerVerdict, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });
});

test('a higher semanticVersion for POLICY_UPDATE is accepted and advances the ledger', async () => {
  const harness = buildHarness();
  await evaluate(buildEnvelope({ semanticVersion: '5.0.0' }), baseContext(), harness);
  const higher = buildEnvelope({ semanticVersion: '6.0.0' });
  const verdict = await evaluate(higher, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('numeric, not lexicographic, semantic version comparison: 1.9.0 < 1.10.0', async () => {
  const harness = buildHarness();
  await evaluate(buildEnvelope({ semanticVersion: '1.9.0' }), baseContext(), harness);
  const verdict = await evaluate(buildEnvelope({ semanticVersion: '1.10.0' }), baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('THIS MODULE ALONE still applies an out-of-order later version immediately -- hold-pending is implemented one layer up, in backend/src/familysync (see OUT_OF_ORDER_HOLD_PENDING_IMPLEMENTED doc comment)', async () => {
  assert.equal(
    OUT_OF_ORDER_HOLD_PENDING_IMPLEMENTED,
    true,
    'PCA-11 (backend/src/familysync/SyncCoordinator.ts) implements hold-pending via correlationId and opt-in numeric-sequence adjacency; this module itself is unchanged and, called directly, still has no gap-detection of its own',
  );
  const harness = buildHarness();
  await evaluate(buildEnvelope({ semanticVersion: '1.0.0' }), baseContext(), harness);

  // N+2 arrives before N+1 (e.g. the receiver was offline for N+1's delivery window).
  const skipsAhead = buildEnvelope({ semanticVersion: '3.0.0' });
  const skipVerdict = await evaluate(skipsAhead, baseContext(), harness);
  assert.deepEqual(
    skipVerdict,
    { accepted: true, idempotent: false },
    'this module in isolation: accepted immediately, not queued -- see familysync/coordinator.test.mjs for the coordinator-layer hold-pending behavior',
  );
});

test('SAFETY PROPERTY preserved despite the limitation above: a genuinely intervening version that arrives late is still correctly and permanently rejected, never mis-applied out of order', async () => {
  const harness = buildHarness();
  await evaluate(buildEnvelope({ semanticVersion: '1.0.0' }), baseContext(), harness);
  await evaluate(buildEnvelope({ semanticVersion: '3.0.0' }), baseContext(), harness); // floor jumps to 3.0.0

  // The "missed" 2.0.0 arrives late -- it must be rejected, never silently
  // accepted into an ambiguous position, and must never move the floor
  // backward or sideways. This is the fail-safe half of the doc 22
  // Section 5 requirement even though the feature-complete "hold pending
  // and apply once the gap fills" half (see the limitation test above)
  // is not implemented.
  const lateIntervening = buildEnvelope({ semanticVersion: '2.0.0' });
  const verdict = await evaluate(lateIntervening, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });
  assert.equal(await harness.versionLedger.getLastAcceptedVersion(lateIntervening.senderKeyId), '3.0.0', 'the floor must remain exactly where it was, never perturbed by a rejected late-arriving envelope');
});

test('dryRun performs every check including signature but records no ledger side effects', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope();
  const verdict = await evaluateEnvelope(
    envelope,
    baseContext(),
    harness.verifier,
    harness.replayLedger,
    harness.versionLedger,
    harness.messageIdempotencyLedger,
    { dryRun: true },
  );
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
  assert.equal(await harness.replayLedger.hasProcessed(envelope.senderKeyId, envelope.sequenceOrNonce), false);
  assert.equal(await harness.messageIdempotencyLedger.getAcceptedCanonicalBytes(envelope.messageId), null);

  // The exact same envelope must still be fully acceptable for real afterward -- dryRun never consumes anything.
  const realVerdict = await evaluate(envelope, baseContext(), harness);
  assert.deepEqual(realVerdict, { accepted: true, idempotent: false });
});

test('dryRun still rejects an invalid signature -- it screens, it does not bypass', async () => {
  const harness = buildHarness();
  const envelope = { ...buildEnvelope(), signature: 'forged' };
  const verdict = await evaluateEnvelope(
    envelope,
    baseContext(),
    harness.verifier,
    harness.replayLedger,
    harness.versionLedger,
    harness.messageIdempotencyLedger,
    { dryRun: true },
  );
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
});

test('SIGNED_ROLLBACK is exempt from version monotonicity and moves the floor DOWN to its target version', async () => {
  const harness = buildHarness();
  await evaluate(buildEnvelope({ semanticVersion: '5.0.0' }), baseContext(), harness);

  const rollback = buildEnvelope({ semanticVersion: '2.0.0', messageType: 'SIGNED_ROLLBACK' });
  const rollbackVerdict = await evaluate(rollback, baseContext(), harness);
  assert.deepEqual(rollbackVerdict, { accepted: true, idempotent: false });

  // The real proof the floor moved DOWN: an intermediate version (3.0.0)
  // between the rollback target (2.0.0) and the stale pre-rollback floor
  // (5.0.0) must be accepted -- only possible if the floor is genuinely 2.0.0.
  const postRollback = buildEnvelope({ semanticVersion: '3.0.0' });
  const verdict = await evaluate(postRollback, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('a SIGNED_ROLLBACK equal to the pre-rollback floor is still exempt from the monotonicity check', async () => {
  const harness = buildHarness();
  await evaluate(buildEnvelope({ semanticVersion: '5.0.0' }), baseContext(), harness);
  const rollback = buildEnvelope({ semanticVersion: '5.0.0', messageType: 'SIGNED_ROLLBACK' });
  const verdict = await evaluate(rollback, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('non-POLICY_UPDATE, non-SIGNED_ROLLBACK message types never consult or update the semantic-version ledger', async () => {
  const harness = buildHarness();
  await evaluate(buildEnvelope({ semanticVersion: '5.0.0' }), baseContext(), harness); // establishes a POLICY_UPDATE floor of 5.0.0

  // A STATUS_SNAPSHOT with a "lower" semanticVersion must not be rejected
  // as non-monotonic -- this ledger has nothing to do with that message type.
  const snapshot = buildEnvelope({ semanticVersion: '1.0.0', messageType: 'STATUS_SNAPSHOT' });
  const verdict = await evaluate(snapshot, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });

  // And the POLICY_UPDATE floor must be unaffected by it.
  assert.equal(await harness.versionLedger.getLastAcceptedVersion('key-1'), '5.0.0');
});

test('a rejected (EXPIRED) envelope never advances the replay ledger -- a corrected legitimate resubmission with the same sequence/nonce can still succeed', async () => {
  const harness = buildHarness();
  const expiredAttempt = buildEnvelope({ sequenceOrNonce: 'seq-shared' });
  const expiredVerdict = await evaluate(
    expiredAttempt,
    baseContext({ now: new Date('2026-01-01T02:00:00.000Z') }),
    harness,
  );
  assert.deepEqual(expiredVerdict, { accepted: false, reason: 'EXPIRED' });

  const resubmission = buildEnvelope({ sequenceOrNonce: 'seq-shared' });
  const verdict = await evaluate(resubmission, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('a rejected (INVALID_SIGNATURE) envelope never advances the semantic-version ledger', async () => {
  const harness = buildHarness();
  const forged = { ...buildEnvelope({ semanticVersion: '10.0.0' }), signature: 'not-a-real-signature' };
  const forgedVerdict = await evaluate(forged, baseContext(), harness);
  assert.deepEqual(forgedVerdict, { accepted: false, reason: 'INVALID_SIGNATURE' });

  const genuine = buildEnvelope({ semanticVersion: '1.0.0' });
  const verdict = await evaluate(genuine, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('a STALE_TRUST_SET_EPOCH rejection never advances the replay ledger', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: 'seq-epoch', trustSetEpoch: 1 });
  const staleVerdict = await evaluate(envelope, baseContext({ minimumAcceptedTrustSetEpoch: 2 }), harness);
  assert.deepEqual(staleVerdict, { accepted: false, reason: 'STALE_TRUST_SET_EPOCH' });
  assert.equal(await harness.replayLedger.hasProcessed(envelope.senderKeyId, 'seq-epoch'), false);

  const verdict = await evaluate(envelope, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('a REPLAYED rejection never advances the semantic-version ledger', async () => {
  const harness = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'seq-1', semanticVersion: '5.0.0' });
  await evaluate(first, baseContext(), harness);

  const replay = buildEnvelope({ sequenceOrNonce: 'seq-1', semanticVersion: '99.0.0' });
  const replayVerdict = await evaluate(replay, baseContext(), harness);
  assert.deepEqual(replayVerdict, { accepted: false, reason: 'REPLAYED' });
  assert.equal(await harness.versionLedger.getLastAcceptedVersion(first.senderKeyId), '5.0.0');
});

test('a VERSION_NOT_MONOTONIC rejection never advances the replay ledger', async () => {
  const harness = buildHarness();
  await evaluate(buildEnvelope({ sequenceOrNonce: 'seq-1', semanticVersion: '5.0.0' }), baseContext(), harness);

  const nonMonotonic = buildEnvelope({ sequenceOrNonce: 'seq-2', semanticVersion: '3.0.0' });
  const rejected = await evaluate(nonMonotonic, baseContext(), harness);
  assert.deepEqual(rejected, { accepted: false, reason: 'VERSION_NOT_MONOTONIC' });
  assert.equal(await harness.replayLedger.hasProcessed(nonMonotonic.senderKeyId, 'seq-2'), false);
});

test('expiry is boundary-inclusive: now exactly equal to expiresAt is rejected', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope();
  const verdict = await evaluate(envelope, baseContext({ now: envelope.expiresAt }), harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'EXPIRED' });
});

test('epoch floors are boundary-inclusive: an envelope exactly at the minimum accepted epoch is accepted', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope({ trustSetEpoch: 2, keyEpoch: 3 });
  const verdict = await evaluate(
    envelope,
    baseContext({ minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 3 }),
    harness,
  );
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('a GROUP recipient envelope is accepted just like a DEVICE recipient one', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope({ recipient: { kind: 'GROUP', recipientGroup: 'all-parents' } });
  const verdict = await evaluate(envelope, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: true, idempotent: false });
});

test('tampering the recipient after signing invalidates the signature -- recipient binding is cryptographically covered', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope();
  const tampered = { ...envelope, recipient: { kind: 'DEVICE', recipientDeviceId: 'someone-else' } };
  const verdict = await evaluate(tampered, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
});

test('a present correlationId is covered by the signature -- tampering it invalidates the signature', async () => {
  const harness = buildHarness();
  const envelope = buildEnvelope({ correlationId: 'corr-1' });
  const tampered = { ...envelope, correlationId: 'corr-2' };
  const verdict = await evaluate(tampered, baseContext(), harness);
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
});
