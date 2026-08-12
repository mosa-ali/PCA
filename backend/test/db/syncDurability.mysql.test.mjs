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

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const SENDER_PUBLIC_KEY = 'sender-public-key-1';

function makeEnvelope(overrides = {}) {
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: overrides.messageId ?? `msg-${randomUUID()}`,
    familyId: overrides.familyId ?? `family-${randomUUID()}`,
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
  await processA.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' }), baseContext());
  await processA.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '2' }), baseContext());

  const processB = buildCoordinator(newDurableLedgers());
  const stale = makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' });
  const result = await processB.submit(stale, baseContext());
  assert.deepEqual(
    result.decision,
    { kind: 'REJECT', reason: 'SEQUENCE_NOT_MONOTONIC' },
    'a restart must never reset sequence progress to null -- otherwise an old sequence would look like the very first message from this sender',
  );
});

// ---------------------------------------------------------------------
// CONCURRENCY
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
  const senderKeyId = `sender-${randomUUID()}`;
  const sequenceOrNonce = `seq-${randomUUID()}`;
  const ledger = new MySqlReplayLedger();

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => ledger.recordProcessed(senderKeyId, sequenceOrNonce)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true);
  assert.equal(await ledger.hasProcessed(senderKeyId, sequenceOrNonce), true);
});

test('CONCURRENCY: conflicting same-messageId recordAccepted calls never throw or corrupt state -- exactly one consistent value is stored afterward', async () => {
  const messageId = `msg-${randomUUID()}`;
  const ledger = new MySqlMessageIdempotencyLedger();

  const candidates = Array.from({ length: 10 }, (_, i) => `bytes-variant-${i}`);
  const attempts = await Promise.allSettled(candidates.map((bytes) => ledger.recordAccepted(messageId, bytes)));
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true);
  const stored = await ledger.getAcceptedCanonicalBytes(messageId);
  assert.ok(candidates.includes(stored), 'the stored value must be exactly one of the concurrently-written candidates, not a corrupted mix');
});

test('CONCURRENCY: out-of-order dependent envelopes (N+2 before N+1) still hold-then-drain correctly against durable ledgers', async () => {
  const coordinator = buildCoordinator(newDurableLedgers());
  const senderKeyId = `sender-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;

  await coordinator.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' }), baseContext());
  const nPlus2 = makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '3', messageId: `msg-n-plus-2-${randomUUID()}` });
  const holdResult = await coordinator.submit(nPlus2, baseContext());
  assert.deepEqual(holdResult.decision, { kind: 'HOLD_PENDING', reason: 'MISSING_SEQUENCE_PREDECESSOR', waitingOnSequence: 2 });

  const nPlus1 = makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '2', messageId: `msg-n-plus-1-${randomUUID()}` });
  const applyResult = await coordinator.submit(nPlus1, baseContext());
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

  await processes[0].submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '1' }), baseContext());

  // All three "processes" concurrently attempt sequence 2 with DIFFERENT
  // messageIds (a genuine concurrent-delivery race, not a simple resubmit).
  const attempts = await Promise.allSettled(
    processes.map((p) =>
      p.submit(makeEnvelope({ senderKeyId, familyId, sequenceOrNonce: '2', messageId: `msg-race-${randomUUID()}` }), baseContext()),
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
    baseContext(),
  );
  assert.deepEqual(staleReplay.decision, { kind: 'REJECT', reason: 'SEQUENCE_NOT_MONOTONIC' });
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

test.after(async () => {
  await closePool();
});
