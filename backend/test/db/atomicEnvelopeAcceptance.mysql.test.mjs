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
import { MySqlEnvelopeAcceptanceTransaction } from '../../dist/familyenvelope/MySqlEnvelopeAcceptanceTransaction.js';
import { evaluateEnvelope } from '../../dist/familyenvelope/FamilyEnvelopeVerifier.js';
import { closePool } from '../../dist/db/pool.js';
import {
  createTestOnlyEnvelopeSignatureVerifier,
  signTestOnlyEnvelope,
} from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

// PCA-17F ATOMIC_ENVELOPE_ACCEPTANCE_RACE: proves the defect PCA-17E left
// open is closed -- MessageIdempotencyLedger's contract says a row means a
// FULLY ACCEPTED envelope, but the old acceptance-ordering saga
// (recordAccepted committing on its own, THEN claimProcessed, THEN
// advancePolicyVersionIfNewer, with compensating DELETEs on a later
// rejection) let a message-id row become visible to OTHER transactions the
// instant step 1 committed -- before replay/version were decided. A
// concurrent identical redelivery landing in that window could observe a
// false `idempotent: true` for an envelope this call goes on to reject.
//
// Every test below drives the REAL MySqlEnvelopeAcceptanceTransaction (the
// production path wired into src/main.ts) through genuine cross-instance
// `Promise.all` concurrency against the SAME live MySQL 8.4 database -- the
// correctness guarantee under test is enforced by InnoDB's own transaction
// isolation/locking, not by anything in this Node process.

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

/** A brand-new set of MySQL-backed repositories PLUS a brand-new atomic acceptance transaction -- simulates a fresh backend process, sharing only the live database, never any in-process object, with every other "process" in a test. */
function newAtomicLedgers() {
  return {
    replayLedger: new MySqlReplayLedger(),
    versionLedger: new MySqlDataVersionLedger(),
    messageIdempotencyLedger: new MySqlMessageIdempotencyLedger(),
    sequenceLedger: new MySqlSequenceProgressLedger(),
    atomicAcceptance: new MySqlEnvelopeAcceptanceTransaction(),
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
    { isNumericSequenceSender: () => false, atomicAcceptance: ledgers.atomicAcceptance, ...options },
  );
}

// ---------------------------------------------------------------------
// Section 6/21(A/B): identical / conflicting concurrent delivery through
// the ATOMIC path specifically (not the legacy saga).
// ---------------------------------------------------------------------

test('PCA-17F ATOMIC: many concurrent instances submitting the IDENTICAL envelope through the atomic path converge to exactly one APPLY_NOW and the rest idempotent', async () => {
  const envelope = makeEnvelope();
  const coordinators = Array.from({ length: 8 }, () => buildCoordinator(newAtomicLedgers()));

  const results = await Promise.all(coordinators.map((c) => c.submit({ ...envelope }, baseContext())));
  const decisions = results.map((r) => r.decision);
  assert.equal(decisions.every((d) => d.kind === 'APPLY_NOW'), true, `every identical concurrent submission must succeed, got ${JSON.stringify(decisions)}`);
  assert.equal(decisions.filter((d) => d.idempotent === false).length, 1, `exactly one durable winner, got ${JSON.stringify(decisions)}`);
  assert.equal(decisions.filter((d) => d.idempotent === true).length, 7);
});

test('PCA-17F ATOMIC: concurrent instances submitting DIFFERENT content under the SAME messageId through the atomic path: exactly one wins, every other is an honest MESSAGE_ID_CONFLICT', async () => {
  const messageId = `msg-${randomUUID()}`;
  const senderKeyId = `sender-${randomUUID()}`;
  const candidates = Array.from({ length: 6 }, (_, i) =>
    makeEnvelope({ messageId, senderKeyId, sequenceOrNonce: `nonce-${i}-${randomUUID()}`, payload: Buffer.from(`payload-${i}`) }),
  );

  const results = await Promise.all(candidates.map((env) => buildCoordinator(newAtomicLedgers()).submit(env, baseContext())));
  const decisions = results.map((r) => r.decision);
  const applied = decisions.filter((d) => d.kind === 'APPLY_NOW');
  const conflicts = decisions.filter((d) => d.kind === 'REJECT' && d.reason === 'MESSAGE_ID_CONFLICT');
  assert.equal(applied.length, 1, `exactly one winner, got ${JSON.stringify(decisions)}`);
  assert.equal(conflicts.length, candidates.length - 1, `every loser must be an honest conflict, got ${JSON.stringify(decisions)}`);
});

// ---------------------------------------------------------------------
// Section 7 / 21(E): PREMATURE-IDEMPOTENCY REPLAY RACE -- the EXACT defect
// PCA-17F closes. Envelope A (message M, nonce N) races envelope X
// (different message, SAME nonce N) for the same (sender, nonce) slot.
// Whichever loses is REPLAYED and its message-id row must be gone (rolled
// back atomically, never left as a dangling "accepted" row a concurrent
// identical retry could observe).
// ---------------------------------------------------------------------

test('PCA-17F ATOMIC PREMATURE_IDEMPOTENCY_REPLAY_RACE: a REPLAYED loser never leaves a durable message-id row a concurrent identical retry could observe as idempotent', async () => {
  const ROUNDS = 15;
  for (let round = 0; round < ROUNDS; round += 1) {
    const senderKeyId = `sender-${randomUUID()}`;
    const sequenceOrNonce = `nonce-${randomUUID()}`;

    const envelopeA = makeEnvelope({ senderKeyId, sequenceOrNonce, messageId: `msg-A-${randomUUID()}` });
    const envelopeX = makeEnvelope({ senderKeyId, sequenceOrNonce, messageId: `msg-X-${randomUUID()}` });

    const [resultA, resultX] = await Promise.all([
      buildCoordinator(newAtomicLedgers()).submit(envelopeA, baseContext()),
      buildCoordinator(newAtomicLedgers()).submit(envelopeX, baseContext()),
    ]);
    const decisions = [resultA.decision, resultX.decision];
    const applied = decisions.filter((d) => d.kind === 'APPLY_NOW');
    const replayed = decisions.filter((d) => d.kind === 'REJECT' && d.reason === 'REPLAYED');
    assert.equal(applied.length, 1, `round ${round}: exactly one APPLY_NOW, got ${JSON.stringify(decisions)}`);
    assert.equal(replayed.length, 1, `round ${round}: exactly one REPLAYED, got ${JSON.stringify(decisions)}`);

    const loserEnvelope = resultA.decision.kind === 'REJECT' ? envelopeA : envelopeX;

    // The core PCA-17F assertion: the loser's message-id row must not
    // exist at all (fully rolled back by the atomic transaction) --
    // confirmed by a genuinely fresh reader.
    const freshReader = new MySqlMessageIdempotencyLedger();
    assert.equal(
      await freshReader.getAcceptedCanonicalBytes(DEFAULT_FAMILY_ID, loserEnvelope.messageId),
      null,
      `round ${round}: the REPLAYED loser's messageId must never be left durably "accepted"`,
    );

    // An identical retry of the LOSER, submitted fresh, must be evaluated
    // normally (and rejected REPLAYED again, honestly) -- never a false
    // idempotent accept from an intermediate row.
    const retryLedgers = newAtomicLedgers();
    const retryResult = await buildCoordinator(retryLedgers).submit({ ...loserEnvelope }, baseContext());
    assert.deepEqual(
      retryResult.decision,
      { kind: 'REJECT', reason: 'REPLAYED' },
      `round ${round}: a fresh retry of the loser's exact messageId must be honestly re-rejected, never short-circuited as idempotent`,
    );
  }
});

test('PCA-17F ATOMIC PREMATURE_IDEMPOTENCY_REPLAY_RACE: a TRUE concurrent identical retry of the eventual loser never observes a false idempotent accept, whatever the real race outcome', async () => {
  const ROUNDS = 10;
  let observedFalseIdempotent = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const senderKeyId = `sender-${randomUUID()}`;
    const sequenceOrNonce = `nonce-${randomUUID()}`;
    const envelopeA = makeEnvelope({ senderKeyId, sequenceOrNonce, messageId: `msg-A-${randomUUID()}` });
    const envelopeX = makeEnvelope({ senderKeyId, sequenceOrNonce, messageId: `msg-X-${randomUUID()}` });
    // A concurrent BYTE-IDENTICAL copy of A, submitted via a totally
    // independent repository/coordinator graph, racing at the SAME time.
    const envelopeARetry = { ...envelopeA };

    const [resultA, resultX, resultARetry] = await Promise.all([
      buildCoordinator(newAtomicLedgers()).submit(envelopeA, baseContext()),
      buildCoordinator(newAtomicLedgers()).submit(envelopeX, baseContext()),
      buildCoordinator(newAtomicLedgers()).submit(envelopeARetry, baseContext()),
    ]);

    // A and its retry must always agree (both eventually resolve to the
    // SAME messageId's true fate): either both APPLY_NOW (A won, retry
    // converges to the SAME accepted content) or both REJECT REPLAYED (X
    // won). They must NEVER disagree -- that disagreement (retry says
    // idempotent-accepted while A itself is REJECTED) is exactly the
    // PCA-17E defect.
    const aOutcome = resultA.decision.kind;
    const retryOutcome = resultARetry.decision.kind;
    if (aOutcome === 'REJECT' && retryOutcome === 'APPLY_NOW') observedFalseIdempotent += 1;
    assert.equal(
      aOutcome === retryOutcome,
      true,
      `round ${round}: A (${JSON.stringify(resultA.decision)}) and its concurrent identical retry (${JSON.stringify(resultARetry.decision)}) must agree on A's messageId's fate`,
    );
    assert.equal(resultX.decision.kind === 'APPLY_NOW' || (resultX.decision.kind === 'REJECT' && resultX.decision.reason === 'REPLAYED'), true);
    // Exactly one of {A, X} applies, never both, never neither.
    const appliedCount = [aOutcome, resultX.decision.kind].filter((k) => k === 'APPLY_NOW').length;
    assert.equal(appliedCount, 1, `round ${round}: exactly one of A/X may apply, got A=${aOutcome} X=${resultX.decision.kind}`);
  }
  assert.equal(observedFalseIdempotent, 0, 'a REJECTED envelope must never have a concurrent identical retry report APPLY_NOW/idempotent');
});

// ---------------------------------------------------------------------
// Section 8 / 21(F): PREMATURE-IDEMPOTENCY VERSION RACE. POLICY_UPDATE A
// (message M, v2) races a DIFFERENT concurrent update (v3, different
// message) for the same (family, sender) version floor. If v3 wins the
// floor, A must be VERSION_NOT_MONOTONIC, its message-id row gone, and a
// concurrent identical retry of A must never see a false idempotent accept.
// ---------------------------------------------------------------------

test('PCA-17F ATOMIC PREMATURE_IDEMPOTENCY_VERSION_RACE: a VERSION_NOT_MONOTONIC loser never leaves a durable message-id row, and the durable floor is always the true maximum', async () => {
  const ROUNDS = 10;
  for (let round = 0; round < ROUNDS; round += 1) {
    const senderKeyId = `sender-${randomUUID()}`;
    const familyId = `family-${randomUUID()}`;

    // Seed a known floor first.
    const seed = makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '1.0.0' });
    const seedResult = await buildCoordinator(newAtomicLedgers()).submit(seed, baseContext({ familyId }));
    assert.deepEqual(seedResult.decision, { kind: 'APPLY_NOW', idempotent: false });

    const envelopeV2 = makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '2.0.0', messageId: `msg-v2-${randomUUID()}` });
    const envelopeV3 = makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '3.0.0', messageId: `msg-v3-${randomUUID()}` });

    const [resultV2, resultV3] = await Promise.all([
      buildCoordinator(newAtomicLedgers()).submit(envelopeV2, baseContext({ familyId })),
      buildCoordinator(newAtomicLedgers()).submit(envelopeV3, baseContext({ familyId })),
    ]);

    // v3 (the higher candidate) can never be legitimately rejected by a
    // race against a lower concurrent candidate.
    assert.equal(resultV3.decision.kind, 'APPLY_NOW', `round ${round}: v3 must always be accepted, got ${JSON.stringify(resultV3.decision)}`);

    const finalFloor = await new MySqlDataVersionLedger().getLastAcceptedVersion(familyId, senderKeyId);
    assert.equal(finalFloor, '3.0.0', `round ${round}: durable floor must equal the true maximum raced version regardless of commit order`);

    if (resultV2.decision.kind === 'REJECT') {
      assert.equal(resultV2.decision.reason, 'VERSION_NOT_MONOTONIC');
      // Core PCA-17F assertion: v2's message-id row must be fully gone.
      const freshReader = new MySqlMessageIdempotencyLedger();
      assert.equal(
        await freshReader.getAcceptedCanonicalBytes(familyId, envelopeV2.messageId),
        null,
        `round ${round}: a VERSION_NOT_MONOTONIC loser's messageId must never be left durably "accepted"`,
      );
      // A concurrent identical retry of v2, submitted fresh, must be
      // honestly re-rejected as stale against the now-durable v3.0.0
      // floor -- never a false idempotent accept from an intermediate row.
      const retryResult = await buildCoordinator(newAtomicLedgers()).submit({ ...envelopeV2 }, baseContext({ familyId }));
      assert.deepEqual(retryResult.decision, { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' });
    } else {
      assert.deepEqual(resultV2.decision, { kind: 'APPLY_NOW', idempotent: false });
    }

    // A late, genuinely stale POLICY_UPDATE from a fresh instance must
    // still be rejected against the now-durable floor.
    const staleResult = await buildCoordinator(newAtomicLedgers()).submit(
      makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '2.0.0', messageId: `msg-stale-${randomUUID()}` }),
      baseContext({ familyId }),
    );
    assert.deepEqual(staleResult.decision, { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' });
  }
});

// ---------------------------------------------------------------------
// Section 10/11: SIGNED_ROLLBACK still participates in the SAME atomic
// transaction, and a rejected ordinary POLICY_UPDATE never leaves a
// dangling message-id row when raced against a rollback.
// ---------------------------------------------------------------------

test('PCA-17F ATOMIC: SIGNED_ROLLBACK commits atomically with the SAME transaction as message-id/replay, and post-rollback updates still require strict increase', async () => {
  const senderKeyId = `sender-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;

  await buildCoordinator(newAtomicLedgers()).submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '5.0.0' }),
    baseContext({ familyId }),
  );

  const regress = await buildCoordinator(newAtomicLedgers()).submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '4.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(regress.decision, { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' });

  const rollback = await buildCoordinator(newAtomicLedgers()).submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'SIGNED_ROLLBACK', semanticVersion: '2.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(rollback.decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.equal(await new MySqlDataVersionLedger().getLastAcceptedVersion(familyId, senderKeyId), '2.0.0');

  const staleAgainstRollback = await buildCoordinator(newAtomicLedgers()).submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '2.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(staleAgainstRollback.decision, { kind: 'REJECT', reason: 'VERSION_NOT_MONOTONIC' });

  const postRollback = await buildCoordinator(newAtomicLedgers()).submit(
    makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '3.0.0' }),
    baseContext({ familyId }),
  );
  assert.deepEqual(postRollback.decision, { kind: 'APPLY_NOW', idempotent: false });
});

// ---------------------------------------------------------------------
// Section 12: MESSAGE-ID CONFLICT within a single family is still exactly
// one winner through the atomic path; different families sharing a
// messageId remain fully independent.
// ---------------------------------------------------------------------

test('PCA-17F ATOMIC: two different families racing the IDENTICAL messageId through the atomic path never collide -- both independently accepted', async () => {
  const familyA = `family-A-${randomUUID()}`;
  const familyB = `family-B-${randomUUID()}`;
  const messageId = `shared-msg-${randomUUID()}`;

  const [resultA, resultB] = await Promise.all([
    buildCoordinator(newAtomicLedgers()).submit(makeEnvelope({ familyId: familyA, messageId }), baseContext({ familyId: familyA })),
    buildCoordinator(newAtomicLedgers()).submit(makeEnvelope({ familyId: familyB, messageId }), baseContext({ familyId: familyB })),
  ]);
  assert.deepEqual(resultA.decision, { kind: 'APPLY_NOW', idempotent: false });
  assert.deepEqual(resultB.decision, { kind: 'APPLY_NOW', idempotent: false });
});

// ---------------------------------------------------------------------
// Section 23: response loss / idempotency -- a fully committed acceptance
// remains stably idempotent for a later, non-concurrent retry (the ordinary
// case, not a true race), proving COMMIT truly finalizes all three ledgers
// together.
// ---------------------------------------------------------------------

test('PCA-17F ATOMIC: a committed acceptance remains stably idempotent for a later sequential retry across every ledger the atomic transaction touched', async () => {
  const senderKeyId = `sender-${randomUUID()}`;
  const familyId = `family-${randomUUID()}`;
  const envelope = makeEnvelope({ familyId, senderKeyId, messageType: 'POLICY_UPDATE', semanticVersion: '1.0.0' });

  const first = await buildCoordinator(newAtomicLedgers()).submit(envelope, baseContext({ familyId }));
  assert.deepEqual(first.decision, { kind: 'APPLY_NOW', idempotent: false });

  // Response "lost" -- caller retries the identical envelope later,
  // sequentially, against a totally fresh set of repositories/instances.
  const retry = await buildCoordinator(newAtomicLedgers()).submit({ ...envelope }, baseContext({ familyId }));
  assert.deepEqual(retry.decision, { kind: 'APPLY_NOW', idempotent: true });

  // Every ledger the transaction touched is durably, consistently settled.
  assert.equal(await new MySqlMessageIdempotencyLedger().getAcceptedCanonicalBytes(familyId, envelope.messageId), canonicalizeEnvelope(envelope));
  assert.equal(await new MySqlReplayLedger().hasProcessed(familyId, senderKeyId, envelope.sequenceOrNonce), true);
  assert.equal(await new MySqlDataVersionLedger().getLastAcceptedVersion(familyId, senderKeyId), '1.0.0');
});

test.after(async () => {
  await closePool();
});
