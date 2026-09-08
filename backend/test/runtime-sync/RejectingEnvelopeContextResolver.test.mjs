// PCA-FINAL-ASSESSMENT 2026-09-08 -- FABLE-A007 regression.
//
// main.ts used to wire an inline envelope-context PLACEHOLDER (empty sender
// key, epoch floors of 0). It was harmless only because the verifier next to
// it (RejectingEnvelopeSignatureVerifier) rejects everything; had a real,
// reviewed verifier been activated without a real Family-Trust-Set resolver,
// epoch-0 envelopes would have been accepted forever -- a live anti-downgrade
// hole. Production now wires rejectingResolveEnvelopeContext instead.
//
// This test proves the resolver is fail-closed BY ITSELF: even with a
// verifier that ACCEPTS a correctly signed envelope, evaluation still rejects
// every envelope, on epoch grounds, before the signature is consulted. The
// negative control proves the same pipeline accepts the same envelope under a
// real context, so the assertion is not vacuous.
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEnvelope } from '../../dist/familyenvelope/FamilyEnvelopeVerifier.js';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import {
  REJECTING_ENVELOPE_CONTEXT_EPOCH_FLOOR,
  rejectingResolveEnvelopeContext,
} from '../../dist/runtime-sync/RejectingCryptoVerifiers.js';
import {
  createTestOnlyEnvelopeSignatureVerifier,
  signTestOnlyEnvelope,
} from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

const SENDER_PUBLIC_KEY = 'sender-public-key-1';
const NOW = new Date('2026-01-01T00:30:00.000Z');
let counter = 0;

function buildSignedEnvelope(overrides = {}) {
  counter += 1;
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: `msg-${counter}`,
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-1' },
    senderKeyId: 'key-1',
    messageType: 'POLICY_UPDATE',
    sequenceOrNonce: `seq-${counter}`,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: '1.0.0',
    correlationId: null,
    payload: Buffer.from('hello'),
    ...overrides,
  };
  return { ...unsigned, signature: signTestOnlyEnvelope(SENDER_PUBLIC_KEY, canonicalizeEnvelope(unsigned)) };
}

function ledgers() {
  return {
    replayLedger: new InMemoryReplayLedger(),
    versionLedger: new InMemoryDataVersionLedger(),
    messageIdempotencyLedger: new InMemoryMessageIdempotencyLedger(),
  };
}

test('the production resolver threads the authoritative familyId/now through and sets unattainable epoch floors', () => {
  const context = rejectingResolveEnvelopeContext('any-key-id', 'family-1', NOW);
  assert.equal(context.familyId, 'family-1');
  assert.equal(context.now, NOW);
  assert.equal(context.senderPublicKey, '');
  assert.equal(context.minimumAcceptedTrustSetEpoch, REJECTING_ENVELOPE_CONTEXT_EPOCH_FLOOR);
  assert.equal(context.minimumAcceptedKeyEpoch, REJECTING_ENVELOPE_CONTEXT_EPOCH_FLOOR);
  assert.equal(REJECTING_ENVELOPE_CONTEXT_EPOCH_FLOOR, Number.MAX_SAFE_INTEGER);
});

test('FAIL-CLOSED: even an ACCEPTING verifier cannot get a correctly signed envelope through the production resolver context', async () => {
  const acceptingVerifier = createTestOnlyEnvelopeSignatureVerifier();
  const envelope = buildSignedEnvelope();
  const { replayLedger, versionLedger, messageIdempotencyLedger } = ledgers();

  const verdict = await evaluateEnvelope(
    envelope,
    rejectingResolveEnvelopeContext(envelope.senderKeyId, 'family-1', NOW),
    acceptingVerifier,
    replayLedger,
    versionLedger,
    messageIdempotencyLedger,
  );
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'STALE_TRUST_SET_EPOCH');
});

test('FAIL-CLOSED holds for the largest epochs a sender could plausibly claim', async () => {
  const acceptingVerifier = createTestOnlyEnvelopeSignatureVerifier();
  const envelope = buildSignedEnvelope({ trustSetEpoch: Number.MAX_SAFE_INTEGER - 1, keyEpoch: Number.MAX_SAFE_INTEGER - 1 });
  const { replayLedger, versionLedger, messageIdempotencyLedger } = ledgers();
  const verdict = await evaluateEnvelope(
    envelope,
    rejectingResolveEnvelopeContext(envelope.senderKeyId, 'family-1', NOW),
    acceptingVerifier,
    replayLedger,
    versionLedger,
    messageIdempotencyLedger,
  );
  assert.equal(verdict.accepted, false);
});

test('NEGATIVE CONTROL: the same envelope and verifier ARE accepted under a real (test) context, so the fail-closed assertion above is not vacuous', async () => {
  const acceptingVerifier = createTestOnlyEnvelopeSignatureVerifier();
  const envelope = buildSignedEnvelope();
  const { replayLedger, versionLedger, messageIdempotencyLedger } = ledgers();
  const verdict = await evaluateEnvelope(
    envelope,
    { senderPublicKey: SENDER_PUBLIC_KEY, minimumAcceptedTrustSetEpoch: 0, minimumAcceptedKeyEpoch: 0, familyId: 'family-1', now: NOW },
    acceptingVerifier,
    replayLedger,
    versionLedger,
    messageIdempotencyLedger,
  );
  assert.equal(verdict.accepted, true);
});

test('main.ts wires the rejecting resolver, never the old inline placeholder', async () => {
  const { readFileSync } = await import('node:fs');
  const mainTs = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.match(mainTs, /resolveEnvelopeContext:\s*rejectingResolveEnvelopeContext/);
  assert.doesNotMatch(mainTs, /minimumAcceptedTrustSetEpoch:\s*0/);
});
