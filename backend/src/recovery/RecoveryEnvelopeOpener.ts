import type { RecoveryRepository } from './RecoveryRepository.js';
import type { RecoveryKdf, RecoveryKdfSuite } from './RecoveryKdf.js';
import type { OpenedRecoveryEnvelope, RecoveryEnvelopeCipher } from './RecoveryEnvelopeCipher.js';
import type { OpaqueFamilyId } from './types.js';

export interface RecoveryEnvelopeOpenRequest {
  familyId: OpaqueFamilyId;
  /** Offline, high-entropy Recovery Secret (doc 09 Section 3.1) -- caller-owned; this function never persists or logs it. */
  recoverySecret: Buffer;
  kdfSalt: Buffer;
  kdfSuite: RecoveryKdfSuite;
  /** Associated data binding familyId, envelope ID, epochs, and suite IDs (doc 09 Section 3.4) -- constructed by the caller from the same fields it will later hand to FamilyTrustSetRecoveryEngine.acceptRecoveryEpoch, so a mismatch between what was authenticated and what is later checked is structurally impossible rather than merely conventional. */
  associatedData: Buffer;
}

/**
 * The actual "retrieve the opaque recovery envelope, derive RWK from RS,
 * open it" flow (doc 09 Section 10 steps 1-2 / doc 21 Section 5 steps
 * 1-2), composing three narrow, already-defined ports
 * (RecoveryRepository, RecoveryKdf, RecoveryEnvelopeCipher) rather than
 * leaving OpenedRecoveryEnvelope as a value that only ever appears
 * already-materialized in tests. This is the ONE place those three ports
 * are wired together; FamilyTrustSetRecoveryEngine.acceptRecoveryEpoch
 * consumes only the resulting OpenedRecoveryEnvelope and never touches
 * RecoveryRepository/RecoveryKdf/RecoveryEnvelopeCipher itself, keeping
 * "fetch and open the envelope" (this function, I/O plus KDF/AEAD) and
 * "decide whether a recovery-authorized epoch is acceptable" (the FTS
 * engine, pure state logic) as separate concerns.
 *
 * Returns `null` on ANY failure -- envelope not found, or the AEAD open
 * itself failing -- never partial/best-effort material. `recoverySecret`
 * and the derived RWK are both zeroized-by-the-caller's-responsibility
 * ephemeral material (doc 09 Section 3.1); this function does not retain
 * either beyond the call.
 */
export async function openStoredRecoveryEnvelope(
  request: RecoveryEnvelopeOpenRequest,
  repository: RecoveryRepository,
  kdf: RecoveryKdf,
  cipher: RecoveryEnvelopeCipher,
): Promise<OpenedRecoveryEnvelope | null> {
  const record = await repository.getEnvelope(request.familyId);
  if (!record) return null;

  const rwk = await kdf.derive(request.recoverySecret, request.kdfSalt, request.kdfSuite);
  const opened = await cipher.open(rwk, record.ciphertext, request.associatedData);
  if (!opened) return null;

  // Defense-in-depth: even if a cipher implementation were ever buggy
  // enough to authenticate against the wrong associated data, the
  // envelope it opened must still claim the SAME family this request was
  // for -- never trust the opened result's own familyId claim over what
  // was actually requested.
  if (opened.familyId !== request.familyId) return null;

  return opened;
}
