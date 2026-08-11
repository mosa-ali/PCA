import type { OpaqueFamilyId } from './types.js';

/**
 * The result of successfully opening a recovery envelope with an RWK
 * (doc 09 Section 3.4): "an authenticated-encrypted object containing
 * only: familyId, envelope format/KDF suite IDs, salt, recovery-envelope
 * ID, creation/key/trust-set epochs, encrypted FDEK(s) and the minimum
 * signed FTS material needed to start recovery." Only the fields the FTS
 * recovery-acceptance layer (FamilyTrustSetRecoveryEngine) needs to verify
 * binding are modeled here -- `wrappedFdek`/FTS material bytes stay opaque
 * and are handled entirely by the recovery-transaction key-rotation step,
 * not by trust-set acceptance.
 *
 * This type is intentionally producible only via a successful
 * `RecoveryEnvelopeCipher.open` call (see below): FamilyTrustSetRecoveryEngine
 * requires a value of this shape as proof that the associated-data-bound
 * AEAD authentication actually succeeded, rather than re-deriving or
 * re-checking any of it itself (this module owns no cryptography). A
 * caller MUST NOT hand-construct one from unverified input -- doing so
 * would bypass the one property this type exists to guarantee.
 */
export interface OpenedRecoveryEnvelope {
  readonly familyId: OpaqueFamilyId;
  readonly recoveryEnvelopeId: string;
  /** The one-time transaction identifier this opened envelope authorizes (doc 09 Section 10). */
  readonly recoveryTransactionId: string;
  /** The trustSetEpoch/keyEpoch the envelope's associated data was bound to at creation/last-refresh time (doc 09 Section 3.4) -- FamilyTrustSetRecoveryEngine checks these against its own locally-held current epoch before trusting this proof. */
  readonly boundTrustSetEpoch: number;
  readonly boundKeyEpoch: number;
}

/**
 * Opens the authenticated-encrypted recovery envelope using the RWK
 * derived by RecoveryKdf. Returns `null` on ANY authentication failure --
 * never partial/best-effort plaintext, mirroring
 * src/familyenvelope/ReceiverPipeline.ts's PayloadDecryptor contract.
 *
 * NO concrete AEAD/KEM construction (doc 09 Section 3.4's candidate
 * pattern is RFC 9180 HPKE for device envelopes plus a reviewed
 * password/recovery-key KDF and AEAD for the RS-protected envelope) is
 * selected or implemented anywhere behind this interface -- production
 * suite selection is gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW
 * (doc 09 Section 3.1/3.6, PCA-DEC-020/PCA-DEC-021).
 */
export interface RecoveryEnvelopeCipher {
  open(rwk: Buffer, ciphertext: Buffer, associatedData: Buffer): Promise<OpenedRecoveryEnvelope | null>;
}
