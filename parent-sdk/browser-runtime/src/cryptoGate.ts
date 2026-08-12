// The single seam every family-content decrypt path in this repository
// slice must go through. This is deliberately NOT a feature flag that some
// build/env config can flip on: it is a hardcoded `false` in source, so
// enabling real family-data decryption requires an actual code change
// (reviewable in a diff), not a config toggle that could be flipped
// silently in an environment file or a deploy pipeline.
//
// PRODUCTION_NOTE: this constant may only ever be flipped to true by a
// commit that (a) references a signed-off human security review of the
// production E2EE crypto suite (docs/architecture/09_SECURITY_PRIVACY_E2EE.md)
// and (b) replaces the NotReadyDecryptor below with a real implementation.
// Until then, every consumer of this module MUST treat family data as
// undecryptable and MUST surface CryptoGateDecision.status ===
// 'NOT_READY_CRYPTO_REVIEW' honestly rather than substituting fixture or
// placeholder data.
import type { CryptoGateDecision } from './types.js';

const CRYPTO_SUITE_APPROVED_FOR_PRODUCTION = false as const;

export function getCryptoGateDecision(): CryptoGateDecision {
  if (CRYPTO_SUITE_APPROVED_FOR_PRODUCTION) {
    return { status: 'READY', reason: 'Production crypto suite approved.' };
  }
  return {
    status: 'NOT_READY_CRYPTO_REVIEW',
    reason:
      'The production E2EE crypto suite has not been human-security-reviewed and approved yet. ' +
      'Family data cannot be decrypted client-side until that review completes -- this is an honest, ' +
      'explicit not-ready state, not a missing feature.',
  };
}

export function isCryptoReviewApproved(): boolean {
  return getCryptoGateDecision().status === 'READY';
}

export class CryptoReviewRequiredError extends Error {
  readonly code = 'NOT_READY_CRYPTO_REVIEW' as const;

  constructor(operation: string) {
    super(
      `${operation} requires the production E2EE crypto suite, which has not been human-security-reviewed ` +
        'and approved yet (see src/cryptoGate.ts). This is a genuine not-ready condition, never fixture data.',
    );
    this.name = 'CryptoReviewRequiredError';
  }
}

/**
 * The decrypt seam. A real implementation (post security-review) would take
 * the family's decryption key material and open `payloadCiphertextBase64`.
 * This package ships only the NotReadyDecryptor: it always reports the gate
 * decision rather than performing any decrypt operation, so nothing in this
 * codebase can accidentally produce a decrypted value from unreviewed code.
 */
export interface EnvelopeDecryptor {
  decrypt(payloadCiphertextBase64: string): Promise<unknown>;
}

export class NotReadyDecryptor implements EnvelopeDecryptor {
  async decrypt(_payloadCiphertextBase64: string): Promise<unknown> {
    throw new CryptoReviewRequiredError('EnvelopeDecryptor.decrypt');
  }
}
