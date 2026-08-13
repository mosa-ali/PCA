import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SyncCoordinator } from '../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../dist/familysync/InMemoryPendingQueueStore.js';
import { MySqlSequenceProgressLedger } from '../../dist/familysync/MySqlSequenceProgressLedger.js';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';
import { MySqlReplayLedger } from '../../dist/familyenvelope/MySqlReplayLedger.js';
import { MySqlDataVersionLedger } from '../../dist/familyenvelope/MySqlDataVersionLedger.js';
import { MySqlMessageIdempotencyLedger } from '../../dist/familyenvelope/MySqlMessageIdempotencyLedger.js';
import { evaluateEnvelope } from '../../dist/familyenvelope/FamilyEnvelopeVerifier.js';
import { closePool } from '../../dist/db/pool.js';
import {
  createTestOnlyEnvelopeSignatureVerifier,
  signTestOnlyEnvelope,
} from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

// PCA-SYNC-DURABILITY-1: proves the four durable ledgers (MySqlReplayLedger,
// MySqlDataVersionLedger, MySqlMessageIdempotencyLedger,
// MySqlSequenceProgressLedger) genuinely survive a backend-process restart
// -- i.e. that a fresh set of repository objects reading the SAME
// underlying MySQL database (never the same in-process object) still
// correctly rejects a replay / downgrade / message-id conflict / stale
// sequence a prior "process" accepted-and-recorded before it was
// "restarted." This is NOT testing InMemory* -- those are gone from this
// file entirely and from src/main.ts's production composition, replaced by
// the MySql* classes under test here.
//
// This file exercises the real crypto-agnostic acceptance pipeline
// (evaluateEnvelope / SyncCoordinator) with the TEST-ONLY, non-production
// signature verifier (test/support/testOnlyEnvelopeSignatureVerifier.mjs,
// which never reaches src/ or dist/) -- it does NOT touch, exercise, or
// alter RejectingDeviceSignatureVerifier/RejectingEnvelopeSignatureVerifier,
// which remain the production default in src/main.ts, unconditionally
// rejecting every real signature. Durable persistence and production crypto
// gating are independent concerns; this suite proves only the former.
//
// PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: every envelope's familyId must
// now match its EnvelopeAcceptanceContext.familyId (the AUTHORITATIVE,
// caller-established family identity) or evaluateEnvelope rejects with
// FAMILY_ID_MISMATCH before touching any ledger -- see
// FamilyEnvelopeVerifier.ts. `makeEnvelope`/`baseContext` below default to
// the SAME shared DEFAULT_FAMILY_ID unless a test explicitly overrides
// both together (or is specifically exercising cross-family isolation, in
// which case each side supplies its own consistent family). The three
// acceptance ledgers (replay, version, idempotency) are now genuinely
// family-scoped in the database (migration 0004) -- this file's own new
// "CROSS-FAMILY ISOLATION" and "CROSS-INSTANCE CONCURRENCY" sections below
// are this lane's primary proof that the fix is real against a live MySQL
// 8.4 database, not merely unit-tested against the in-memory ledgers.

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const SENDER_PUBLIC_KEY = 'sender-public-key-1';
const DEFAULT_FAMILY_ID = `family-default-${randomUUID()}`;

function makeEnvelope(overrides = {}) {
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: overrides.messageId ?? `msg-${randomUUID()}`,
    familyId: overrides.familyId ?? DEFAULT_FAMILY_ID,
    senderDeviceId: 'device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-1' },
    senderKeyId: overrides.senderKeyId ?? `sender-${randomUUID()}`,
    messageType: overrides.messageType ?? 'STATUS_SNAPSHOT',
    sequenceOrNonce: overrides.sequenceOrNonce ?? `nonce-${randomUUID()}`,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: overrides.semanticVersion ?? '1.0.0',
    correlationId: overrides.correlationId ?? null,
    payload: Buffer.from(`opaque-payload-${randomUUID()}`),
    ...overrides,
  };
  const signature = signTestOnlyEnvelope(SENDER_PUBLIC_KEY, canonicalizeEnvelope(unsigned));
  return { ...unsigned, signature };
}

function baseContext(overrides = {}) {
  return {
    senderPublicKey: SENDER_PUBLIC_KEY,
    minimumAcceptedTrustSetEpoch: 0,
    minimumAcceptedKeyEpoch: 0,
    familyId: DEFAULT_FAMILY_ID,
    now: new Date('2026-01-01T00:30:00.000Z'),
    ...overrides,
  };
}

/** A brand-new set of MySQL-backed ledger repositories -- simulates "a fresh backend process" reading the same database, never the same in-process objects as a prior "instance." */
function newDurableLedgers() {
  return {
    replayLedger: new MySqlReplayLedger(),
    versionLedger: new MySqlDataVersionLedger(),
    messageIdempotencyLedger: new MySqlMessageIdempotencyLedger(),
    sequenceLedger: new MySqlSequenceProgressLedger(),
  };
}

function buildCoordinator(ledgers, options = {}) {
  return new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    ledgers.sequenceLedger,
    ledgers.replayLedger,
    ledgers.versionLedger,
    ledgers.messageIdempotencyLedger,
    createTestOnlyEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: options.isNumericSequenceSender ?? (() => true), ...options },
  );
}

// ---------------------------------------------------------------------
// RESTART HARD GATE
// ---------------------------------------------------------------------

test('RESTART: a "process A" accepted envelope is still correctly rejected as REPLAYED by a genuinely fresh "process B" reading the same database', async () => {
  const senderKeyId = `sender-${randomUUID()}`;
  const sequenceOrNonce = `seq-${randomUUID()}`;

  // "Process A": accept and durably record an envelope.
  const processA = buildCoordinator(newDurableLedgers());
  const original = makeEnvelope({ senderKeyId, sequenceOrNonce, messageId: `msg-${randomUUID()}` });
  const firstResult = await processA.submit(original, baseContext());
  assert.deepEqual(firstResult.decision, { kind: 'APPLY_NOW', idempotent: false });
  // "Process A" is now destroyed -- no reference to it, its ledgers, or its
  // in-process Maps/objects survives past this point. Only the underlying
  // MySQL database (PCA_DATABASE_URL) persists.

  // "Process B": brand-new repository objects, brand-new SyncCoordinator,
  // same DB. A captured-and-replayed envelope reusing the SAME
  // senderKeyId+sequenceOrNonce but a DIFFERENT messageId (so the replay
  // ledger -- not the message-idempotency short-circuit -- is what is
  // actually being tested) must still be rejected.
  const processB = buildCoordinator(newDurableLedgers());
  const replay = makeEnvelope({ senderKeyId, sequenceOrNonce, messageId: `msg-${randomUUID()}` });
  const replayResult = await processB.submit(replay, baseContext());
  assert.deepEqual(replayResult.decision, { kind: 'REJECT', reason: 'REPLAYED' });
});

test('RESTART: a "process B" rejects a stale POLICY_UPDATE version below the floor "process A" already accepted', async () => {
  const senderKeyId = `sender-${randomUUID()}`;

  const processA = buildCoordinator(newDurableLedgers());
  const high = makeEnvelope({ senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '5.0.0' });
  const highResult = await processA.submit(high, baseContext());
  assert.deepEqual(highResult.decision, { kind: 'APPLY_NOW', idempotent: false });

  const processB = buildCoordinator(newDurableLedgers());
  const stale = makeEnvelope({ senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '2.0.0' });
  const staleResult = await processB.submit(stale, baseContext());
  assert.deepEqual(
    staleResult.decision,
    { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' },
    'a restart must never reset the anti-downgrade floor -- otherwise a stale, previously-superseded POLICY_UPDATE could be silently re-accepted',
  );
});

test('RESTART: a "process B" rejects a MESSAGE_ID_CONFLICT for a messageId "process A" already accepted with different content', async () => {
  const messageId = `msg-${randomUUID()}`;

  const processA = buildCoordinator(newDurableLedgers());
  const original = makeEnvelope({ messageId });
  const originalResult = await processA.submit(original, baseContext());
  assert.deepEqual(originalResult.decision, { kind: 'APPLY_NOW', idempotent: false });

  const processB = buildCoordinator(newDurableLedgers());
  const conflicting = makeEnvelope({ messageId, senderKeyId: original.senderKeyId, payload: Buffer.from('different-payload') });
  const conflictResult = await processB.submit(conflicting, baseContext());
  assert.equal(conflictResult.decision.kind, 'REJECT');
  assert.equal(conflictResult.decision.reason, 'MESSAGE_ID_CONFLICT');

  // And the byte-identical redelivery of the ORIGINAL envelope still short-circuits to a stable, idempotent accept.
  const processC = buildCoordinator(newDurableLedgers());
  const identicalRedelivery = { ...original };
  const idempotentResult = await processC.submit(identicalRedelivery, baseContext());
  assert.deepEqual(idempotentResult.decision, { kind: 'APPLY_NOW', idempotent: true });
});

test('RESTART: a "process B" rejects a stale/non-monotonic numeric sequence "process A" already advanced past', async () => {
  const senderKeyId = `sender-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;

  const processA = buildCoordinator(newDurableLedgers());
  await processA.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' }), baseContext({ familyId }));
  await processA.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '2' }), baseContext({ familyId }));

  const processB = buildCoordinator(newDurableLedgers());
  const stale = makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' });
  const result = await processB.submit(stale, baseContext({ familyId }));
  assert.deepEqual(
    result.decision,
    { kind: 'REJECT', reason: 'SEQUENCE_NOT_MONOTONIC' },
    'a restart must never reset sequence progress to null -- otherwise an old sequence would look like the very first message from this sender',
  );
});

// ---------------------------------------------------------------------
// PCA-17C: AUTHORITATIVE FAMILY IDENTITY
// ---------------------------------------------------------------------

test('PCA-17C: SyncCoordinator rejects an envelope whose self-declared familyId does not match the AUTHORITATIVE context.familyId, against real durable ledgers', async () => {
  const coordinator = buildCoordinator(newDurableLedgers());
  const forged = makeEnvelope({ familyId: `family-attacker-${randomUUID()}` });
  const result = await coordinator.submit(forged, baseContext({ familyId: `family-victim-${randomUUID()}` }));
  assert.deepEqual(result.decision, { kind: 'REJECT', reason: 'FAMILY_ID_MISMATCH' });
});

test('PCA-17C: evaluateEnvelope rejects FAMILY_ID_MISMATCH before ever touching the durable ledgers (no row is written for the rejected attempt)', async () => {
  const ledgers = newDurableLedgers();
  const verifier = createTestOnlyEnvelopeSignatureVerifier();
  const messageId = `msg-${randomUUID()}`;
  const forged = makeEnvelope({ familyId: `family-attacker-${randomUUID()}`, messageId });

  const verdict = await evaluateEnvelope(
    forged,
    baseContext({ familyId: `family-victim-${randomUUID()}` }),
    verifier,
    ledgers.replayLedger,
    ledgers.versionLedger,
    ledgers.messageIdempotencyLedger,
  );
  assert.deepEqual(verdict, { accepted: false, reason: 'FAMILY_ID_MISMATCH' });
  assert.equal(await ledgers.messageIdempotencyLedger.getAcceptedCanonicalBytes(forged.familyId, messageId), null);
});

// ---------------------------------------------------------------------
// PCA-17C: CROSS-FAMILY ISOLATION (against a real, live-migrated MySQL 8.4
// database -- migration 0004_envelope_ledger_family_scope.sql)
// ---------------------------------------------------------------------

test('PCA-17C CROSS-FAMILY: identical (senderKeyId, sequenceOrNonce) accepted for family A never REPLAYs for family B, durably', async () => {
  const familyA = `family-A-${randomUUID()}`;
  const familyB = `family-B-${randomUUID()}`;
  const senderKeyId = `shared-key-${randomUUID()}`;
  const sequenceOrNonce = `shared-seq-${randomUUID()}`;

  const processA = buildCoordinator(newDurableLedgers());
  const resultA = await processA.submit(
    makeEnvelope({ familyId: familyA, senderKeyId, sequenceOrNonce }),
    baseContext({ familyId: familyA }),
  );
  assert.deepEqual(resultA.decision, { kind: 'APPLY_NOW', idempotent: false });

  // A genuinely fresh "process" (simulating a restart) for family B.
  const processB = buildCoordinator(newDurableLedgers());
  const resultB = await processB.submit(
    makeEnvelope({ familyId: familyB, senderKeyId, sequenceOrNonce }),
    baseContext({ familyId: familyB }),
  );
  assert.deepEqual(
    resultB.decision,
    { kind: 'APPLY_NOW', idempotent: false },
    'family B\'s independent envelope must never be rejected as REPLAYED just because family A used the identical (senderKeyId, sequenceOrNonce) pair',
  );
});

test('PCA-17C CROSS-FAMILY: identical messageId with DIFFERENT content in two different families never conflicts, durably', async () => {
  const familyA = `family-A-${randomUUID()}`;
  const familyB = `family-B-${randomUUID()}`;
  const messageId = `shared-msg-${randomUUID()}`;

  const processA = buildCoordinator(newDurableLedgers());
  const resultA = await processA.submit(
    makeEnvelope({ familyId: familyA, messageId, payload: Buffer.from('family-A-content') }),
    baseContext({ familyId: familyA }),
  );
  assert.deepEqual(resultA.decision, { kind: 'APPLY_NOW', idempotent: false });

  const processB = buildCoordinator(newDurableLedgers());
  const resultB = await processB.submit(
    makeEnvelope({ familyId: familyB, messageId, payload: Buffer.from('family-B-DIFFERENT-content') }),
    baseContext({ familyId: familyB }),
  );
  assert.deepEqual(
    resultB.decision,
    { kind: 'APPLY_NOW', idempotent: false },
    'family B\'s DIFFERENT content under the identical messageId must never be treated as MESSAGE_ID_CONFLICT against family A\'s unrelated acceptance',
  );
});

test('PCA-17C CROSS-FAMILY: identical senderKeyId POLICY_UPDATE version floors are fully independent per family, durably', async () => {
  const familyA = `family-A-${randomUUID()}`;
  const familyB = `family-B-${randomUUID()}`;
  const senderKeyId = `shared-key-${randomUUID()}`;

  const processA = buildCoordinator(newDurableLedgers());
  await processA.submit(
    makeEnvelope({ familyId: familyA, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '9.0.0' }),
    baseContext({ familyId: familyA }),
  );

  const processB = buildCoordinator(newDurableLedgers());
  const resultB = await processB.submit(
    makeEnvelope({ familyId: familyB, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '1.0.0' }),
    baseContext({ familyId: familyB }),
  );
  assert.deepEqual(
    resultB.decision,
    { kind: 'APPLY_NOW', idempotent: false },
    'family B must have its own independent version floor, never rejected as VERSION_NOT_MONOTONIC against family A\'s unrelated higher floor for the same senderKeyId',
  );
});

// ---------------------------------------------------------------------
// CONCURRENCY (pre-existing, within-family)
// ---------------------------------------------------------------------

test('CONCURRENCY: many concurrent identical-envelope submissions (same messageId, same bytes) all resolve consistently, none corrupt the ledger', async () => {
  const coordinator = buildCoordinator(newDurableLedgers());
  const envelope = makeEnvelope();
  const attempts = await Promise.allSettled(
    Array.from({ length: 15 }, () => coordinator.submit({ ...envelope }, baseContext())),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'no concurrent identical submission may throw');
  const applied = attempts.filter((a) => a.value.decision.kind === 'APPLY_NOW');
  assert.equal(applied.length, 15, 'every identical resubmission must resolve to APPLY_NOW (fresh or idempotent)');
});

test('CONCURRENCY: same numeric sequence delivered concurrently by many "processes" converges to one consistent applied ceiling', async () => {
  const senderKeyId = `sender-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;
  const ledger = new MySqlSequenceProgressLedger();

  await Promise.all(
    [5, 3, 9, 1, 7, 2, 8, 4, 6].map((sequence) => ledger.recordAppliedSequence(familyId, senderKeyId, sequence)),
  );
  const finalValue = await ledger.getLastAppliedSequence(familyId, senderKeyId);
  assert.equal(finalValue, 9, 'concurrent recordAppliedSequence calls must converge to the MAXIMUM, never a stale overwrite');
});

test('CONCURRENCY: duplicate-envelope (same senderKeyId+sequenceOrNonce) recordProcessed calls from many concurrent callers are all idempotent, never throw, never double-count', async () => {
  const familyId = `family-${randomUUID()}`;
  const senderKeyId = `sender-${randomUUID()}`;
  const sequenceOrNonce = `seq-${randomUUID()}`;
  const ledger = new MySqlReplayLedger();

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => ledger.recordProcessed(familyId, senderKeyId, sequenceOrNonce)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true);
  assert.equal(await ledger.hasProcessed(familyId, senderKeyId, sequenceOrNonce), true);
});

test('CONCURRENCY: out-of-order dependent envelopes (N+2 before N+1) still hold-then-drain correctly against durable ledgers', async () => {
  const coordinator = buildCoordinator(newDurableLedgers());
  const senderKeyId = `sender-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;

  await coordinator.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' }), baseContext({ familyId }));
  const nPlus2 = makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '3', messageId: `msg-n-plus-2-${randomUUID()}` });
  const holdResult = await coordinator.submit(nPlus2, baseContext({ familyId }));
  assert.deepEqual(holdResult.decision, { kind: 'HOLD_PENDING', reason: 'MISSING_SEQUENCE_PREDECESSOR', waitingOnSequence: 2 });

  const nPlus1 = makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '2', messageId: `msg-n-plus-1-${randomUUID()}` });
  const applyResult = await coordinator.submit(nPlus1, baseContext({ familyId }));
  assert.deepEqual(applyResult.decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.equal(applyResult.drained.length, 1);
  assert.deepEqual(applyResult.drained[0].decision, { kind: 'APPLY_NOW', idempotent: false });
});

test('CONCURRENCY: multiple independent repository-instance "processes" racing to advance the same sender\'s sequence never let a replay through', async () => {
  const senderKeyId = `sender-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;

  // Three fully independent coordinator+ledger-object graphs, each standing
  // in for a separate backend process instance, all pointed at the SAME
  // underlying MySQL database (the pool itself is a process-local
  // singleton in this test runner, but every correctness guarantee here is
  // enforced by the DB's own atomic UPSERT/unique-constraint semantics,
  // not by anything in-process -- see MySqlSequenceProgressLedger's and
  // MySqlReplayLedger's own doc comments).
  const processes = [buildCoordinator(newDurableLedgers()), buildCoordinator(newDurableLedgers()), buildCoordinator(newDurableLedgers())];

  await processes[0].submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' }), baseContext({ familyId }));

  // All three "processes" concurrently attempt sequence 2 with DIFFERENT
  // messageIds (a genuine concurrent-delivery race, not a simple resubmit).
  const attempts = await Promise.allSettled(
    processes.map((p) =>
      p.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '2', messageId: `msg-race-${randomUUID()}` }), baseContext({ familyId })),
    ),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true);
  const applied = attempts.filter((a) => a.value.decision.kind === 'APPLY_NOW');
  // At least one must succeed (liveness); every non-applied outcome must be
  // an honest REJECT/HOLD, never a silently-corrupted duplicate accept.
  assert.ok(applied.length >= 1, 'at least one concurrent delivery of sequence 2 must be accepted');

  // A genuinely stale replay of sequence 1 afterward, from a FOURTH fresh
  // "process," must still be rejected -- the race above must not have
  // corrupted the durable sequence floor.
  const processFour = buildCoordinator(newDurableLedgers());
  const staleReplay = await processFour.submit(
    makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1', messageId: `msg-stale-${randomUUID()}` }),
    baseContext({ familyId }),
  );
  assert.deepEqual(staleReplay.decision, { kind: 'REJECT', reason: 'SEQUENCE_NOT_MONOTONIC' });
});

// ---------------------------------------------------------------------
// PCA-17C: CROSS-INSTANCE CONCURRENCY -- the crux of the MySQL
// message-idempotency-ledger fix (MySqlMessageIdempotencyLedger's plain
// INSERT + duplicate-key-readback conflict resolution, replacing the old
// unconditional ON DUPLICATE KEY UPDATE). Every ledger instance below is a
// genuinely separate object graph (simulating a separate backend process),
// racing via TRUE Promise.all concurrency against the SAME live MySQL 8.4
// database -- the correctness guarantee under test is enforced entirely by
// InnoDB's own unique-index locking, not by anything in this Node process.
// ---------------------------------------------------------------------

test('PCA-17C CROSS-INSTANCE (a): many independent ledger instances racing to accept the SAME messageId with IDENTICAL canonicalBytes all converge to success (recorded XOR already-idempotent), never a spurious conflict', async () => {
  const familyId = `family-${randomUUID()}`;
  const messageId = `msg-${randomUUID()}`;
  const canonicalBytes = `identical-canonical-bytes-${randomUUID()}`;
  const instances = Array.from({ length: 8 }, () => new MySqlMessageIdempotencyLedger());

  const results = await Promise.all(instances.map((ledger) => ledger.recordAccepted(familyId, messageId, canonicalBytes)));
  assert.equal(results.every((r) => r.outcome === 'recorded' || r.outcome === 'already-idempotent'), true, `every concurrent identical-content acceptance must succeed (recorded or already-idempotent), got: ${JSON.stringify(results)}`);
  assert.equal(results.filter((r) => r.outcome === 'recorded').length, 1, 'exactly one instance durably wins the INSERT race; every other instance observes already-idempotent, never a second physical row');

  const finalReadBack = await new MySqlMessageIdempotencyLedger().getAcceptedCanonicalBytes(familyId, messageId);
  assert.equal(finalReadBack, canonicalBytes, 'a genuinely fresh instance reading the DB afterward must see exactly the content every racer agreed on');
});

test('PCA-17C CROSS-INSTANCE (b): independent ledger instances racing to accept the SAME messageId with DIFFERENT canonicalBytes: exactly one wins as recorded, every other is a conflict -- content is never silently overwritten', async () => {
  const familyId = `family-${randomUUID()}`;
  const messageId = `msg-${randomUUID()}`;
  const candidates = Array.from({ length: 8 }, (_, i) => `distinct-canonical-bytes-variant-${i}-${randomUUID()}`);

  const results = await Promise.all(
    candidates.map((bytes) => new MySqlMessageIdempotencyLedger().recordAccepted(familyId, messageId, bytes)),
  );
  const recordedCount = results.filter((r) => r.outcome === 'recorded').length;
  const conflictCount = results.filter((r) => r.outcome === 'conflict').length;
  assert.equal(recordedCount, 1, `exactly one concurrent DIFFERENT-content acceptance must win as 'recorded', got ${recordedCount} of ${JSON.stringify(results)}`);
  assert.equal(conflictCount, candidates.length - 1, 'every other concurrent DIFFERENT-content acceptance must be an honest conflict, never silently absorbed or silently overwriting the winner');

  // The durably stored content must be EXACTLY the one winning candidate --
  // never a corrupted mix, never the LAST writer silently clobbering an
  // EARLIER committed winner (the old unconditional
  // `ON DUPLICATE KEY UPDATE canonical_bytes = VALUES(...)` behavior this
  // lane replaced).
  const finalReadBack = await new MySqlMessageIdempotencyLedger().getAcceptedCanonicalBytes(familyId, messageId);
  assert.ok(candidates.includes(finalReadBack), 'the stored value must be exactly one of the concurrently-attempted candidates');
  const winnerIndex = results.findIndex((r) => r.outcome === 'recorded');
  assert.equal(finalReadBack, candidates[winnerIndex], 'the durably stored content must be exactly the SAME candidate that won as recorded, proving no later loser silently overwrote it');
});

test('PCA-17C CROSS-INSTANCE (c): independent ledger instances racing on the IDENTICAL messageId but DIFFERENT authoritative families never collide -- both families independently win as recorded', async () => {
  const familyA = `family-A-${randomUUID()}`;
  const familyB = `family-B-${randomUUID()}`;
  const messageId = `shared-msg-${randomUUID()}`;

  const [resultA, resultB] = await Promise.all([
    new MySqlMessageIdempotencyLedger().recordAccepted(familyA, messageId, 'family-A-content'),
    new MySqlMessageIdempotencyLedger().recordAccepted(familyB, messageId, 'family-B-DIFFERENT-content'),
  ]);
  assert.deepEqual(resultA, { outcome: 'recorded' }, 'family A\'s acceptance of this messageId must never be blocked or converted to a conflict by family B\'s concurrent, unrelated acceptance of the identical messageId');
  assert.deepEqual(resultB, { outcome: 'recorded' });

  assert.equal(await new MySqlMessageIdempotencyLedger().getAcceptedCanonicalBytes(familyA, messageId), 'family-A-content');
  assert.equal(await new MySqlMessageIdempotencyLedger().getAcceptedCanonicalBytes(familyB, messageId), 'family-B-DIFFERENT-content');
});

test('PCA-17C CROSS-INSTANCE: a large, MIXED concurrent race (identical-content duplicates interleaved with genuinely conflicting content, across two families) resolves with no throw, no corruption, and the correct per-family winner', async () => {
  const familyA = `family-A-${randomUUID()}`;
  const familyB = `family-B-${randomUUID()}`;
  const messageId = `msg-${randomUUID()}`;

  const attempts = [
    ...Array.from({ length: 5 }, () => ({ familyId: familyA, bytes: 'family-A-agreed-content' })), // 5 identical-content racers for family A
    ...Array.from({ length: 3 }, (_, i) => ({ familyId: familyA, bytes: `family-A-conflicting-${i}` })), // genuine conflicts for family A
    ...Array.from({ length: 4 }, () => ({ familyId: familyB, bytes: 'family-B-agreed-content' })), // identical-content racers for family B
  ];

  const settled = await Promise.allSettled(
    attempts.map(({ familyId, bytes }) => new MySqlMessageIdempotencyLedger().recordAccepted(familyId, messageId, bytes)),
  );
  assert.equal(settled.every((s) => s.status === 'fulfilled'), true, 'no concurrent call may throw -- every outcome is a typed result, never an unhandled DB error');
  const results = settled.map((s) => s.value);

  const familyAResults = results.slice(0, 8);
  const familyBResults = results.slice(8);

  // Family A: exactly one of the 8 total attempts (5 identical + 3
  // conflicting) durably wins as 'recorded'; the rest are either
  // 'already-idempotent' (if the winner happened to be 'family-A-agreed-content')
  // or 'conflict'.
  const familyARecorded = familyAResults.filter((r) => r.outcome === 'recorded');
  assert.equal(familyARecorded.length, 1, `family A must have exactly one durable winner, got ${JSON.stringify(familyAResults)}`);

  // Family B: all 4 attempts share identical content, so all must succeed
  // (recorded XOR already-idempotent), never a conflict.
  assert.equal(familyBResults.every((r) => r.outcome !== 'conflict'), true, 'family B\'s identical-content racers must never see a conflict');
  assert.equal(familyBResults.filter((r) => r.outcome === 'recorded').length, 1);

  // Final durable state is exactly one consistent value per family.
  const finalA = await new MySqlMessageIdempotencyLedger().getAcceptedCanonicalBytes(familyA, messageId);
  const finalB = await new MySqlMessageIdempotencyLedger().getAcceptedCanonicalBytes(familyB, messageId);
  assert.ok(attempts.filter((a) => a.familyId === familyA).some((a) => a.bytes === finalA));
  assert.equal(finalB, 'family-B-agreed-content');
});

// ---------------------------------------------------------------------
// evaluateEnvelope-level sanity (below SyncCoordinator) -- proves the
// durable ledgers satisfy FamilyEnvelopeVerifier's contract directly, not
// only through SyncCoordinator's own additional serialization.
// ---------------------------------------------------------------------

test('evaluateEnvelope: durable ledgers correctly gate accept -> replay -> reject across two independent repository instances', async () => {
  const ledgersA = newDurableLedgers();
  const envelope = makeEnvelope();
  const verifier = createTestOnlyEnvelopeSignatureVerifier();

  const firstVerdict = await evaluateEnvelope(
    envelope,
    baseContext(),
    verifier,
    ledgersA.replayLedger,
    ledgersA.versionLedger,
    ledgersA.messageIdempotencyLedger,
  );
  assert.deepEqual(firstVerdict, { accepted: true, idempotent: false });

  const ledgersB = newDurableLedgers();
  const replay = makeEnvelope({ senderKeyId: envelope.senderKeyId, sequenceOrNonce: envelope.sequenceOrNonce });
  const replayVerdict = await evaluateEnvelope(
    replay,
    baseContext(),
    verifier,
    ledgersB.replayLedger,
    ledgersB.versionLedger,
    ledgersB.messageIdempotencyLedger,
  );
  assert.deepEqual(replayVerdict, { accepted: false, reason: 'REPLAYED' });
});

// ---------------------------------------------------------------------
// PCA-17E: REPLAY_MULTI_INSTANCE_TOCTOU -- a TRUE cross-instance race:
// two independent MySqlReplayLedger/MySqlMessageIdempotencyLedger/
// SyncCoordinator object graphs, sharing one live MySQL 8.4 database,
// racing the SAME (familyId, senderKeyId, sequenceOrNonce) under TWO
// DIFFERENT messageIds via genuine Promise.all concurrency. Before this
// lane, `hasProcessed` + `recordProcessed` were separate DB calls -- both
// racers could observe `hasProcessed === false` before either had written
// anything, letting both be accepted. `claimProcessed`'s atomic INSERT
// against the (family_id, sender_key_id, sequence_or_nonce) unique key is
// what this test proves closes that gap for real, not merely in a
// single-process unit test.
// ---------------------------------------------------------------------

test('PCA-17E REPLAY_MULTI_INSTANCE_TOCTOU: two independent instances racing the SAME (family, sender, nonce) under DIFFERENT messageIds -- exactly one APPLY_NOW, one REPLAYED, every round', async () => {
  const ROUNDS = 20;
  for (let round = 0; round < ROUNDS; round += 1) {
    const familyId = `family-${randomUUID()}`;
    const senderKeyId = `sender-${randomUUID()}`;
    const sequenceOrNonce = `nonce-${randomUUID()}`;

    const coordinatorA = buildCoordinator(newDurableLedgers());
    const coordinatorB = buildCoordinator(newDurableLedgers());
    const envelopeA = makeEnvelope({ familyId, senderKeyId, sequenceOrNonce, messageId: `msg-A-${randomUUID()}` });
    const envelopeB = makeEnvelope({ familyId, senderKeyId, sequenceOrNonce, messageId: `msg-B-${randomUUID()}` });

    const [resultA, resultB] = await Promise.all([
      coordinatorA.submit(envelopeA, baseContext({ familyId })),
      coordinatorB.submit(envelopeB, baseContext({ familyId })),
    ]);
    const decisions = [resultA.decision, resultB.decision];
    const applied = decisions.filter((d) => d.kind === 'APPLY_NOW');
    const replayed = decisions.filter((d) => d.kind === 'REJECT' && d.reason === 'REPLAYED');
    assert.equal(applied.length, 1, `round ${round}: exactly one APPLY_NOW expected, got ${JSON.stringify(decisions)}`);
    assert.equal(replayed.length, 1, `round ${round}: exactly one REPLAYED rejection expected -- never two APPLY_NOW, got ${JSON.stringify(decisions)}`);

    // The REPLAYED loser's own messageId must NOT be left durably
    // "accepted" (see FamilyEnvelopeVerifier's releaseAccepted compensation)
    // -- otherwise a future genuine retry of that exact messageId would
    // incorrectly short-circuit to a stable idempotent accept instead of
    // being correctly re-rejected.
    const loserMessageId = resultA.decision.kind === 'REJECT' ? envelopeA.messageId : envelopeB.messageId;
    const freshCheck = new MySqlMessageIdempotencyLedger();
    assert.equal(
      await freshCheck.getAcceptedCanonicalBytes(familyId, loserMessageId),
      null,
      `round ${round}: the REPLAYED loser's messageId must never be left recorded as accepted`,
    );
  }
});

// ---------------------------------------------------------------------
// PCA-17E: POLICY_VERSION_MULTI_INSTANCE_TOCTOU -- a TRUE cross-instance
// race: two independent instances concurrently accepting DIFFERENT
// POLICY_UPDATE versions (2.0.0 and 3.0.0) against the SAME durable floor
// (1.0.0). Before this lane, MySqlDataVersionLedger.recordAcceptedVersion
// was an unconditional `ON DUPLICATE KEY UPDATE` -- pure last-write-wins,
// so commit ORDER alone (not version magnitude) could leave the durable
// floor at the LOWER value if v2's write landed after v3's. This test
// proves `advancePolicyVersionIfNewer`'s read-compare-write CAS converges
// to the correct maximum regardless of commit order, and that a race
// LOSER is honestly reported, never silently accepted while contradicting
// the durable floor.
// ---------------------------------------------------------------------

test('PCA-17E POLICY_VERSION_MULTI_INSTANCE_TOCTOU: two independent instances racing DIFFERENT POLICY_UPDATE versions against the same floor converge to the correct maximum, never a downgrade', async () => {
  const ROUNDS = 10;
  for (let round = 0; round < ROUNDS; round += 1) {
    const familyId = `family-${randomUUID()}`;
    const senderKeyId = `sender-${randomUUID()}`;

    const seedCoordinator = buildCoordinator(newDurableLedgers());
    const seedResult = await seedCoordinator.submit(
      makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '1.0.0' }),
      baseContext({ familyId }),
    );
    assert.deepEqual(seedResult.decision, { kind: 'APPLY_NOW', idempotent: false });

    const coordinatorV2 = buildCoordinator(newDurableLedgers());
    const coordinatorV3 = buildCoordinator(newDurableLedgers());
    const envelopeV2 = makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '2.0.0', messageId: `msg-v2-${randomUUID()}` });
    const envelopeV3 = makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '3.0.0', messageId: `msg-v3-${randomUUID()}` });

    const [resultV2, resultV3] = await Promise.all([
      coordinatorV2.submit(envelopeV2, baseContext({ familyId })),
      coordinatorV3.submit(envelopeV3, baseContext({ familyId })),
    ]);

    // v3 (the higher candidate) can never be legitimately rejected as
    // stale by a race against a LOWER concurrent candidate.
    assert.equal(resultV3.decision.kind, 'APPLY_NOW', `round ${round}: v3 must always be accepted, got ${JSON.stringify(resultV3.decision)}`);
    // v2 either genuinely wins too (both applied; final floor still ends
    // at 3.0.0 either way -- see below) or is an honest race loser once
    // v3's commit becomes durable first -- both are correct depending on
    // real execution/commit order, but v2 must never silently "succeed"
    // while contradicting what the durable floor now says.
    assert.ok(
      resultV2.decision.kind === 'APPLY_NOW' || (resultV2.decision.kind === 'REJECT' && resultV2.decision.reason === 'VERSION_NOT_MONOTONIC'),
      `round ${round}: v2 must either be genuinely applied or honestly rejected as stale, got ${JSON.stringify(resultV2.decision)}`,
    );

    const finalFloor = await new MySqlDataVersionLedger().getLastAcceptedVersion(familyId, senderKeyId);
    assert.equal(finalFloor, '3.0.0', `round ${round}: final durable floor must equal the highest raced version regardless of commit order`);

    // A late, genuinely stale POLICY_UPDATE from a FOURTH fresh "process"
    // must still be rejected against the now-durable floor.
    const staleCoordinator = buildCoordinator(newDurableLedgers());
    const staleResult = await staleCoordinator.submit(
      makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '2.0.0', messageId: `msg-stale-${randomUUID()}` }),
      baseContext({ familyId }),
    );
    assert.deepEqual(staleResult.decision, { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' });
  }
});

// ---------------------------------------------------------------------
// PCA-17E: SIGNED_ROLLBACK_SEPARATION regression -- re-proves ordinary
// POLICY_UPDATE cannot move backwards, SIGNED_ROLLBACK can move backwards
// only through its own explicit path, and post-rollback ordinary updates
// still require a strict increase from the rollback floor -- against the
// REAL durable MySQL-backed ledgers (not just the in-memory unit tests in
// test/familyenvelope/dataVersionLedger.test.mjs and verifier.test.mjs).
// ---------------------------------------------------------------------

test('PCA-17E SIGNED_ROLLBACK_SEPARATION: durable ledgers -- ordinary POLICY_UPDATE never regresses, SIGNED_ROLLBACK moves the floor down, and post-rollback updates still require strict increase', async () => {
  const familyId = `family-${randomUUID()}`;
  const senderKeyId = `sender-${randomUUID()}`;

  const c1 = buildCoordinator(newDurableLedgers());
  await c1.submit(makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '5.0.0' }), baseContext({ familyId }));

  const c2 = buildCoordinator(newDurableLedgers());
  const regressAttempt = await c2.submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '4.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(regressAttempt.decision, { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' });

  const c3 = buildCoordinator(newDurableLedgers());
  const rollback = await c3.submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'SIGNED_ROLLBACK', semanticVersion: '2.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(rollback.decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.equal(await new MySqlDataVersionLedger().getLastAcceptedVersion(familyId, senderKeyId), '2.0.0');

  const c4 = buildCoordinator(newDurableLedgers());
  const staleAgainstRollback = await c4.submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '2.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(staleAgainstRollback.decision, { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' }, 'a post-rollback ordinary update still requires a STRICT increase from the rollback floor');

  const c5 = buildCoordinator(newDurableLedgers());
  const postRollback = await c5.submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '3.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(postRollback.decision, { kind: 'APPLY_NOW', idempotent: false });
});

test.after(async () => {
  await closePool();
});
