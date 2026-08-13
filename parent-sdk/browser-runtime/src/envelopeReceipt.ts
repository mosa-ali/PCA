// Local state-machine plumbing for receiving an opaque encrypted family
// envelope and attempting to move it toward DECRYPTED. The actual decrypt
// call is delegated to an injected EnvelopeDecryptor (see cryptoGate.ts) --
// this module never performs cryptography itself, only sequencing and the
// local checks (trust state, FTS freshness) that must pass before decrypt
// is even attempted.
import type { EnvelopeDecryptor } from './cryptoGate.js';
import { getCryptoGateDecision } from './cryptoGate.js';
import type {
  EncryptedFamilyEnvelope,
  EnvelopeReceipt,
  FamilyTrustSet,
  TrustedEndpointState,
} from './types.js';
import { verifyFamilyTrustSet } from './familyTrustSet.js';

export function receiveEnvelope(envelope: EncryptedFamilyEnvelope, nowUtc: Date = new Date()): EnvelopeReceipt {
  return {
    envelope,
    state: 'RECEIVED',
    receivedAtUtc: nowUtc.toISOString(),
    lastAttemptAtUtc: null,
    decryptedPayload: null,
  };
}

export interface AttemptDecryptInput {
  receipt: EnvelopeReceipt;
  endpointState: TrustedEndpointState;
  fts: FamilyTrustSet | null;
  acceptedMinEpoch: number | null;
  localEndpointId: string;
  decryptor: EnvelopeDecryptor;
  nowUtc?: Date;
}

/**
 * Advances a receipt one step. Order of checks is deliberate and fail-closed:
 * 1. Endpoint must be TRUSTED (not merely service-authenticated).
 * 2. The envelope's familyId must match the FTS's familyId -- an envelope
 *    from a different family paired with a locally-cached FTS must never be
 *    allowed to proceed toward decrypt, even though the FTS's own local
 *    checks (epoch/expiry/endpoint-authorization) say nothing about which
 *    family it belongs to.
 * 3. The FTS supplied must locally verify as current for this endpoint.
 * 4. Only then is the crypto gate consulted -- today that always reports
 *    NOT_READY_CRYPTO_REVIEW, so `decryptor` is never actually reached with
 *    real, unreviewed cryptography from this repository slice
 *    (NotReadyDecryptor is the only decryptor this repo ships).
 */
export async function attemptDecrypt(input: AttemptDecryptInput): Promise<EnvelopeReceipt> {
  const nowUtc = input.nowUtc ?? new Date();
  const attemptedAt = nowUtc.toISOString();

  if (input.endpointState !== 'TRUSTED') {
    return { ...input.receipt, state: 'DECRYPT_BLOCKED_UNTRUSTED_ENDPOINT', lastAttemptAtUtc: attemptedAt };
  }

  if (!input.fts) {
    return { ...input.receipt, state: 'DECRYPT_BLOCKED_STALE_FTS', lastAttemptAtUtc: attemptedAt };
  }

  if (input.receipt.envelope.familyId !== input.fts.familyId) {
    return { ...input.receipt, state: 'DECRYPT_BLOCKED_FAMILY_MISMATCH', lastAttemptAtUtc: attemptedAt };
  }

  const ftsResult = verifyFamilyTrustSet({
    fts: input.fts,
    acceptedMinEpoch: input.acceptedMinEpoch,
    localEndpointId: input.localEndpointId,
    nowUtc,
  });
  if (!ftsResult.ok) {
    return { ...input.receipt, state: 'DECRYPT_BLOCKED_STALE_FTS', lastAttemptAtUtc: attemptedAt };
  }

  // The envelope's own claimed ftsEpoch must be COVERED BY the locally-
  // verified current epoch (envelope.ftsEpoch <= fts.epoch), never ahead of
  // it. An envelope claiming a newer epoch than what this endpoint has
  // locally verified as current means the locally-cached FTS is itself
  // stale relative to this envelope -- we cannot know whether this endpoint
  // is even still authorized at that future epoch, so this must fail
  // closed exactly like any other stale-FTS condition rather than proceed.
  // An envelope from an OLDER epoch than fts.epoch is not rejected here:
  // whether an older-epoch envelope remains decryptable is a key-selection
  // question for the (not yet reviewed) crypto suite, not this module.
  if (input.receipt.envelope.ftsEpoch > input.fts.epoch) {
    return { ...input.receipt, state: 'DECRYPT_BLOCKED_STALE_FTS', lastAttemptAtUtc: attemptedAt };
  }

  const gate = getCryptoGateDecision();
  if (gate.status !== 'READY') {
    return { ...input.receipt, state: 'DECRYPT_BLOCKED_CRYPTO_REVIEW', lastAttemptAtUtc: attemptedAt };
  }

  const decryptedPayload = await input.decryptor.decrypt(input.receipt.envelope.payloadCiphertextBase64);
  return { ...input.receipt, state: 'DECRYPTED', lastAttemptAtUtc: attemptedAt, decryptedPayload };
}
