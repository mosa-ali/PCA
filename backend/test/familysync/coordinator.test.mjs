import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncCoordinator } from '../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../dist/familysync/InMemoryPendingQueueStore.js';
import { InMemorySequenceProgressLedger } from '../../dist/familysync/InMemorySequenceProgressLedger.js';
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
    messageType: 'STATUS_SNAPSHOT',
    sequenceOrNonce: `nonce-${messageCounter}`,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
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

function buildBadEnvelope(overrides = {}) {
  return { ...buildEnvelope(overrides), signature: 'forged-signature' };
}

function buildHarness(options = {}) {
  return new SyncCoordinator(
    new InMemoryPendingQueueStore(...(options.storeCaps ?? [])),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: options.isNumericSequenceSender ?? (() => true), ...options },
  );
}

function baseContext(overrides = {}) {
  return {
    senderPublicKey: SENDER_PUBLIC_KEY,
    minimumAcceptedTrustSetEpoch: 0,
    minimumAcceptedKeyEpoch: 0,
    familyId: 'family-1',
    now: new Date('2026-01-01T00:30:00.000Z'),
    ...overrides,
  };
}

// ---- basic apply / idempotency ----

test('N arrives -> applies', async () => {
  const coordinator = buildHarness();
  const result = await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext());
  assert.deepEqual(result.decision, { kind: 'APPLY_NOW', idempotent: false });
});

test('N duplicate -> idempotent', async () => {
  const coordinator = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: '1' });
  await coordinator.submit(envelope, baseContext());
  const second = await coordinator.submit(envelope, baseContext());
  assert.deepEqual(second.decision, { kind: 'APPLY_NOW', idempotent: true });
});

// ---- numeric-sequence gap hold/drain ----

test('N+2 arrives before required N+1 -> HOLD_PENDING', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext());
  const result = await coordinator.submit(buildEnvelope({ sequenceOrNonce: '3' }), baseContext());
  assert.deepEqual(result.decision, { kind: 'HOLD_PENDING', reason: 'MISSING_SEQUENCE_PREDECESSOR', waitingOnSequence: 2 });
});

test('N+2 held pending does not affect active/applied sequence state', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext());
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '3' }), baseContext());
  const stillOne = await coordinator.submit(buildEnvelope({ sequenceOrNonce: '2' }), baseContext());
  // N=2 applies cleanly (no interference from the pending N=3), proving N=3 never silently advanced state.
  assert.deepEqual(stillOne.decision, { kind: 'APPLY_NOW', idempotent: false });
});

test('N+1 arrives -> N+1 applies first, then eligible N+2 drains, in order', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext());
  const nPlus2 = buildEnvelope({ sequenceOrNonce: '3', messageId: 'msg-n-plus-2' });
  await coordinator.submit(nPlus2, baseContext());

  const nPlus1 = buildEnvelope({ sequenceOrNonce: '2', messageId: 'msg-n-plus-1' });
  const result = await coordinator.submit(nPlus1, baseContext());
  assert.deepEqual(result.decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.deepEqual(result.drained, [{ messageId: 'msg-n-plus-2', decision: { kind: 'APPLY_NOW', idempotent: false } }]);
});

test('N+2 expires while pending -> never applies', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext());
  const nPlus2 = buildEnvelope({
    sequenceOrNonce: '3',
    messageId: 'msg-expiring',
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
  });
  await coordinator.submit(nPlus2, baseContext());

  const nPlus1 = buildEnvelope({ sequenceOrNonce: '2' });
  const result = await coordinator.submit(nPlus1, baseContext({ now: new Date('2026-01-01T02:00:00.000Z') }));
  assert.deepEqual(result.decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.deepEqual(result.drained, [], 'the expired N+2 must never appear in the drain -- it was purged before drain ran');

  // Resubmitting the exact same (now long-expired) envelope must still never apply.
  const resubmit = await coordinator.submit(nPlus2, baseContext({ now: new Date('2026-01-01T02:00:00.000Z') }));
  assert.equal(resubmit.decision.kind, 'REJECT');
});

// ---- correlation (request/decision) dependency ----

test('a correlation-dependent message (PARENT_DECISION) holds pending until its CHILD_REQUEST is accepted', async () => {
  const coordinator = buildHarness();
  const request = buildEnvelope({ messageType: 'CHILD_REQUEST', messageId: 'req-1', sequenceOrNonce: 'r1' });
  const decision = buildEnvelope({
    messageType: 'PARENT_DECISION',
    messageId: 'dec-1',
    correlationId: 'req-1',
    sequenceOrNonce: 'd1',
  });

  const decisionFirst = await coordinator.submit(decision, baseContext());
  assert.deepEqual(decisionFirst.decision, {
    kind: 'HOLD_PENDING',
    reason: 'MISSING_CORRELATION_PREDECESSOR',
    waitingOnMessageId: 'req-1',
  });

  const requestResult = await coordinator.submit(request, baseContext());
  assert.equal(requestResult.decision.kind, 'APPLY_NOW');
  assert.deepEqual(requestResult.drained, [{ messageId: 'dec-1', decision: { kind: 'APPLY_NOW', idempotent: false } }]);
});

// ---- security screening of pending candidates ----

test('bad signature pending candidate -> reject, never queue as trusted (exercises the dry-run admission screen, not the ordinary accept path)', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext()); // establish a floor so seq=3 is a genuine gap
  const forged = buildBadEnvelope({ sequenceOrNonce: '3' }); // would otherwise HOLD_PENDING on missing seq 2
  const result = await coordinator.submit(forged, baseContext());
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'INVALID_SIGNATURE' });

  // Prove it was never queued: the legitimate seq=2 arrives and its drain is empty, not containing the forged seq=3.
  const legitimateTwo = await coordinator.submit(buildEnvelope({ sequenceOrNonce: '2' }), baseContext());
  assert.deepEqual(legitimateTwo.drained, []);
});

test('stale trustSetEpoch pending candidate -> reject (genuine gap, exercises the dry-run admission screen)', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext({ minimumAcceptedTrustSetEpoch: 1 }));
  const stale = buildEnvelope({ sequenceOrNonce: '3', trustSetEpoch: 0 });
  const result = await coordinator.submit(stale, baseContext({ minimumAcceptedTrustSetEpoch: 1 }));
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'STALE_TRUST_SET_EPOCH' });
});

test('stale keyEpoch pending candidate -> reject (genuine gap, exercises the dry-run admission screen)', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext({ minimumAcceptedKeyEpoch: 1 }));
  const stale = buildEnvelope({ sequenceOrNonce: '3', keyEpoch: 0 });
  const result = await coordinator.submit(stale, baseContext({ minimumAcceptedKeyEpoch: 1 }));
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'STALE_KEY_EPOCH' });
});

test('messageId conflict (same id, different canonical content) -> reject', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ messageId: 'shared-id', sequenceOrNonce: '1' }), baseContext());
  const conflicting = buildEnvelope({ messageId: 'shared-id', sequenceOrNonce: '1', payload: Buffer.from('different') });
  const result = await coordinator.submit(conflicting, baseContext());
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'MESSAGE_ID_CONFLICT' });
});

test('replayed sequence/nonce -> reject', async () => {
  const coordinator = buildHarness();
  const first = buildEnvelope({ sequenceOrNonce: 'reused-nonce', messageId: 'msg-a' });
  await coordinator.submit(first, baseContext());
  const replay = buildEnvelope({ sequenceOrNonce: 'reused-nonce', messageId: 'msg-b' });
  const result = await coordinator.submit(replay, baseContext());
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'REPLAYED' });
});

test('a numeric sequence at or below the last applied one is rejected as non-monotonic', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '5' }), baseContext());
  const result = await coordinator.submit(buildEnvelope({ sequenceOrNonce: '5', messageId: 'msg-repeat' }), baseContext());
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'SEQUENCE_NOT_MONOTONIC' });
});

// ---- reconnect / offline ----

test('offline reconnect -> deterministic drain regardless of relay delivery order', async () => {
  const harnessOptions = { isNumericSequenceSender: () => true };
  const coordinatorA = buildHarness(harnessOptions);
  const coordinatorB = buildHarness(harnessOptions);

  const e1 = buildEnvelope({ sequenceOrNonce: '1', messageId: 'e1' });
  const e2 = buildEnvelope({ sequenceOrNonce: '2', messageId: 'e2' });
  const e3 = buildEnvelope({ sequenceOrNonce: '3', messageId: 'e3' });

  const resultsForward = await coordinatorA.reconnectDrain([e1, e2, e3], baseContext());
  const resultsReversed = await coordinatorB.reconnectDrain([e3, e2, e1], baseContext());

  const finalKindsA = resultsForward.map((r) => r.decision.kind);
  const finalKindsB = resultsReversed.map((r) => r.decision.kind);
  assert.deepEqual(finalKindsA, ['APPLY_NOW', 'APPLY_NOW', 'APPLY_NOW']);
  assert.deepEqual(finalKindsB, ['APPLY_NOW', 'APPLY_NOW', 'APPLY_NOW']);
});

test('duplicate reconnect drains are idempotent', async () => {
  const coordinator = buildHarness();
  const e1 = buildEnvelope({ sequenceOrNonce: '1', messageId: 'e1' });
  const e2 = buildEnvelope({ sequenceOrNonce: '2', messageId: 'e2' });

  await coordinator.reconnectDrain([e1, e2], baseContext());
  const secondPass = await coordinator.reconnectDrain([e1, e2], baseContext());
  assert.deepEqual(
    secondPass.map((r) => r.decision),
    [
      { kind: 'APPLY_NOW', idempotent: true },
      { kind: 'APPLY_NOW', idempotent: true },
    ],
  );
});

// ---- queue bounds ----

test('queue limit -> fail-safe bound (per-sender)', async () => {
  const coordinator = buildHarness({ maxPendingPerSender: 2, storeCaps: [2] });
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '100' }), baseContext()); // establish a floor
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '110' }), baseContext()); // pending #1
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '120' }), baseContext()); // pending #2
  const overLimit = await coordinator.submit(buildEnvelope({ sequenceOrNonce: '130' }), baseContext()); // pending #3, over cap
  assert.deepEqual(overLimit.decision, { kind: 'REJECT', reason: 'PENDING_SENDER_QUEUE_FULL' });
});

test('multiple family/sender isolation: one sender at its cap does not block another sender or family', async () => {
  const coordinator = buildHarness({ maxPendingPerSender: 1, storeCaps: [1] });
  await coordinator.submit(buildEnvelope({ senderKeyId: 'key-a', sequenceOrNonce: '10' }), baseContext());
  await coordinator.submit(buildEnvelope({ senderKeyId: 'key-a', sequenceOrNonce: '20' }), baseContext()); // fills key-a's 1 pending slot

  // A different sender, given its own established baseline, can still hold pending -- key-a's full queue never blocks it.
  await coordinator.submit(buildEnvelope({ senderKeyId: 'key-b', sequenceOrNonce: '10' }), baseContext());
  const otherSender = await coordinator.submit(buildEnvelope({ senderKeyId: 'key-b', sequenceOrNonce: '20' }), baseContext());
  assert.equal(otherSender.decision.kind, 'HOLD_PENDING');

  // Likewise a different family (with its own distinct senderKeyId -- a
  // real senderKeyId is a device signing-key identifier, globally unique,
  // never legitimately reused across two different families) is an
  // entirely independent (family, sender) pair for sequence tracking.
  // context.familyId is the AUTHORITATIVE family identity (PCA-17C) -- it
  // must match each envelope's own familyId here for these to be accepted
  // at all, exactly like a real second family's own device session would
  // supply its own authoritative context.
  const family2Context = baseContext({ familyId: 'family-2' });
  await coordinator.submit(buildEnvelope({ familyId: 'family-2', senderKeyId: 'key-c', sequenceOrNonce: '10' }), family2Context);
  const otherFamily = await coordinator.submit(
    buildEnvelope({ familyId: 'family-2', senderKeyId: 'key-c', sequenceOrNonce: '20' }),
    family2Context,
  );
  assert.equal(otherFamily.decision.kind, 'HOLD_PENDING');
});

// ---------------------------------------------------------------------
// PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY
// ---------------------------------------------------------------------

test('PCA-17C: SyncCoordinator rejects an envelope whose self-declared familyId does not match the AUTHORITATIVE context.familyId, never applying or queueing it', async () => {
  const coordinator = buildHarness();
  const forged = buildEnvelope({ familyId: 'family-1', sequenceOrNonce: '1' });
  const result = await coordinator.submit(forged, baseContext({ familyId: 'family-VICTIM' }));
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'FAMILY_ID_MISMATCH' });
  assert.deepEqual(result.drained, []);
});

test('PCA-17C: a family-mismatched envelope never gets queued as a trusted pending candidate even when it looks like a genuine out-of-order gap', async () => {
  const coordinator = buildHarness();
  // Establish a real floor for the VICTIM family so sequence 3 below would
  // otherwise look like a legitimate out-of-order gap (HOLD_PENDING) if the
  // family check were not enforced first.
  await coordinator.submit(buildEnvelope({ familyId: 'family-VICTIM', sequenceOrNonce: '1' }), baseContext({ familyId: 'family-VICTIM' }));

  const forged = buildEnvelope({ familyId: 'family-ATTACKER', sequenceOrNonce: '3' });
  const result = await coordinator.submit(forged, baseContext({ familyId: 'family-VICTIM' }));
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'FAMILY_ID_MISMATCH' }, 'must reject on the family check, never HOLD_PENDING it as if it were a genuine gap in the victim family\'s sequence');

  // Prove it was never queued: the legitimate seq=2 arrives for the victim
  // family and its drain is empty, not containing the forged seq=3.
  const legitimateTwo = await coordinator.submit(buildEnvelope({ familyId: 'family-VICTIM', sequenceOrNonce: '2' }), baseContext({ familyId: 'family-VICTIM' }));
  assert.deepEqual(legitimateTwo.drained, []);
});

// ---- concurrency red-team ----

test('the same message arriving concurrently never double-applies or leaves stray pending state', async () => {
  const coordinator = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: '1' });
  const [a, b] = await Promise.all([coordinator.submit(envelope, baseContext()), coordinator.submit(envelope, baseContext())]);
  assert.equal(a.decision.kind, 'APPLY_NOW');
  assert.equal(b.decision.kind, 'APPLY_NOW');
});

test('RED-TEAM FIX: two concurrent byte-identical submissions collapse onto ONE actual evaluation -- both callers observe the identical single outcome, never two independent (and possibly conflicting) accepts', async () => {
  const coordinator = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: '1' });
  const [a, b] = await Promise.all([coordinator.submit(envelope, baseContext()), coordinator.submit(envelope, baseContext())]);
  assert.deepEqual(a.decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.deepEqual(a.decision, b.decision, 'both concurrent callers must see the SAME single accept -- neither independently raced to its own idempotent:false');

  // A genuinely later, separate call now correctly observes it as already applied.
  const later = await coordinator.submit(envelope, baseContext());
  assert.deepEqual(later.decision, { kind: 'APPLY_NOW', idempotent: true });
});

test('RED-TEAM FIX: three-way concurrent identical submission still yields exactly one underlying evaluation (all three see the same outcome)', async () => {
  const coordinator = buildHarness();
  const envelope = buildEnvelope({ sequenceOrNonce: '1' });
  const results = await Promise.all([
    coordinator.submit(envelope, baseContext()),
    coordinator.submit(envelope, baseContext()),
    coordinator.submit(envelope, baseContext()),
  ]);
  assert.deepEqual(results[0].decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.deepEqual(results[1].decision, results[0].decision);
  assert.deepEqual(results[2].decision, results[0].decision);
});

test('RED-TEAM FIX: a concurrent submission with the SAME messageId but DIFFERENT content is NOT deduplicated -- it is independently caught as a conflict', async () => {
  const coordinator = buildHarness();
  const original = buildEnvelope({ sequenceOrNonce: '1', messageId: 'shared' });
  const conflicting = buildEnvelope({ sequenceOrNonce: '1', messageId: 'shared', payload: Buffer.from('different') });
  const [a, b] = await Promise.all([coordinator.submit(original, baseContext()), coordinator.submit(conflicting, baseContext())]);
  const kinds = [a.decision.kind, b.decision.kind].sort();
  // One of the two applies; the other is rejected as a conflict -- never both silently applied.
  assert.deepEqual(kinds, ['APPLY_NOW', 'REJECT']);
});

test('two concurrent FIRST-EVER messages from a fresh sender both apply safely (no established floor to gap-check against yet)', async () => {
  const coordinator = buildHarness();
  const a = buildEnvelope({ sequenceOrNonce: '5', messageId: 'first-a' });
  const b = buildEnvelope({ sequenceOrNonce: '6', messageId: 'first-b' });
  const [resultA, resultB] = await Promise.all([coordinator.submit(a, baseContext()), coordinator.submit(b, baseContext())]);
  assert.equal(resultA.decision.kind, 'APPLY_NOW');
  assert.equal(resultB.decision.kind, 'APPLY_NOW');
  // KNOWN, DOCUMENTED LIMITATION: a receiver with no prior floor for a
  // sender cannot distinguish "this really is that sender's first message"
  // from "earlier messages existed but this receiver never saw them" --
  // exactly analogous to FamilyTrustSetEngine's genesis trust-on-first-use.
  // Gap detection only activates once a floor is established.
});

test('successor first, predecessor later (sequential) yields exactly one deterministic apply for each, via drain', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext()); // establishes the floor

  const successor = buildEnvelope({ sequenceOrNonce: '3', messageId: 'succ-3' });
  const heldResult = await coordinator.submit(successor, baseContext());
  assert.equal(heldResult.decision.kind, 'HOLD_PENDING');

  const predecessor = buildEnvelope({ sequenceOrNonce: '2', messageId: 'pred-2' });
  const applyResult = await coordinator.submit(predecessor, baseContext());
  assert.equal(applyResult.decision.kind, 'APPLY_NOW');
  assert.deepEqual(applyResult.drained, [{ messageId: 'succ-3', decision: { kind: 'APPLY_NOW', idempotent: false } }]);
});

test('predecessor + successor arriving CONCURRENTLY (floor already established): the predecessor applies, and the successor -- which raced past the drain window -- converges to applied on the next family activity, never lost, never double-applied', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext()); // establishes the floor at 1

  const predecessor = buildEnvelope({ sequenceOrNonce: '2', messageId: 'pred-concurrent' });
  const successor = buildEnvelope({ sequenceOrNonce: '3', messageId: 'succ-concurrent' });
  const [predResult, succResult] = await Promise.all([
    coordinator.submit(predecessor, baseContext()),
    coordinator.submit(successor, baseContext()),
  ]);
  assert.equal(predResult.decision.kind, 'APPLY_NOW');
  // LIVENESS NOTE (not a safety gap): this coordinator drains a family's
  // pending queue only when a new envelope for that family is accepted --
  // there is no background timer. A successor whose dependency became
  // satisfied WHILE it was still mid-flight (e.g. still running its own
  // pending-admission security screen) may or may not be retroactively
  // drained by the predecessor's OWN concurrent drainFamily call -- this is
  // a genuine race between two independent submit() calls (different
  // messageIds are never serialized against each other -- see
  // SyncCoordinator's chainByKey doc comment), and PCA-SYNC-DURABILITY-1's
  // ledger-durability change (every ledger call is now async, an
  // additional microtask tick even for the in-memory implementations)
  // legitimately shifts which side of that race wins on a given run. Both
  // outcomes are safe and already covered by this coordinator's own
  // contract: EITHER the successor is drained already, as a side effect of
  // the predecessor's own submit() (successor kind === 'APPLY_NOW', or
  // present in predResult.drained), OR it is still genuinely held and
  // safely applies on the family's next activity or its own resubmission.
  // What must NEVER happen, regardless of which side of the race wins: the
  // successor is lost, or applied more than once.
  const succAppliedInline = succResult.decision.kind === 'APPLY_NOW';
  const succDrainedByPredecessor = predResult.drained.some((d) => d.messageId === 'succ-concurrent');
  assert.ok(
    succAppliedInline || succDrainedByPredecessor || succResult.decision.kind === 'HOLD_PENDING',
    `successor must be applied or held pending, never rejected/lost -- got ${succResult.decision.kind}`,
  );

  // Any subsequent accepted envelope for the SAME FAMILY (any sender) drains
  // the whole family's pending queue -- exactly the "next family activity"
  // convergence trigger described above. A first-ever message from an
  // unrelated sender in the same family applies immediately and, as a side
  // effect, drains anything still genuinely pending (including the
  // successor, if it was not already applied above).
  const unrelatedSenderMessage = buildEnvelope({ senderKeyId: 'key-unrelated', sequenceOrNonce: 'n/a' });
  const triggerResult = await coordinator.submit(unrelatedSenderMessage, baseContext());
  assert.equal(triggerResult.decision.kind, 'APPLY_NOW');
  const succDrainedByTrigger = triggerResult.drained.some((d) => d.messageId === 'succ-concurrent');

  // CONVERGENCE (never lost): the successor must have been applied through
  // EXACTLY ONE of these three paths -- inline in its own submit() call,
  // as a side effect of the predecessor's concurrent drain, or as a side
  // effect of the later trigger's drain.
  const applyPaths = [succAppliedInline, succDrainedByPredecessor, succDrainedByTrigger].filter(Boolean);
  assert.equal(applyPaths.length, 1, `successor must converge to applied through exactly one path, saw ${applyPaths.length}`);
});

test('expiry racing dependency arrival: the predecessor arriving exactly at the successor expiry threshold does not resurrect it', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(
    buildEnvelope({ sequenceOrNonce: '1' }),
    baseContext({ now: new Date('2025-12-31T23:00:00.000Z') }),
  ); // establishes the floor at 1

  const successor = buildEnvelope({
    sequenceOrNonce: '3',
    messageId: 'succ-race',
    expiresAt: new Date('2026-01-01T00:10:00.000Z'),
  });
  await coordinator.submit(successor, baseContext({ now: new Date('2026-01-01T00:00:00.000Z') }));

  const predecessor = buildEnvelope({ sequenceOrNonce: '2', messageId: 'pred-race' });
  const result = await coordinator.submit(predecessor, baseContext({ now: new Date('2026-01-01T00:10:00.000Z') }));
  assert.equal(result.decision.kind, 'APPLY_NOW');
  assert.deepEqual(result.drained, [], 'expiry is boundary-inclusive (now >= expiresAt), so the race resolves toward expiry, never a late apply');
});

// ---- last-valid state preserved on failure ----

test('last-valid sequence progress is preserved when a later candidate is rejected', async () => {
  const coordinator = buildHarness();
  await coordinator.submit(buildEnvelope({ sequenceOrNonce: '1' }), baseContext());
  await coordinator.submit(buildBadEnvelope({ sequenceOrNonce: '2' }), baseContext()); // rejected, bad signature, no gap since seq=2 is next
  // seq 2 must still be treated as un-applied -- the legitimate seq 2 can still arrive and apply.
  const legitimateTwo = await coordinator.submit(buildEnvelope({ sequenceOrNonce: '2', messageId: 'legit-2' }), baseContext());
  assert.deepEqual(legitimateTwo.decision, { kind: 'APPLY_NOW', idempotent: false });
});
