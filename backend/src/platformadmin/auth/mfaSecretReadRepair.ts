import { encryptTotpSecret, type MfaEncryptionKeyring } from './totp.js';

/**
 * BOUNDED MFA KEY-ROTATION READ REPAIR.
 *
 * The key ring lets a secret sealed under a legacy key still be decrypted, so a
 * rotation no longer locks anyone out. On its own that is only half a rotation:
 * unless the row is re-sealed under the ACTIVE key, the legacy key has to stay
 * configured forever, or that admin breaks the day it is retired. This is the
 * other half.
 *
 * WHERE THIS IS CALLED FROM, AND WHY IT IS NOT ONE PLACE
 * ------------------------------------------------------
 * A legacy-sealed secret can be found at two different moments, which live in
 * two different parts of the domain:
 *   - PENDING_SETUP: mid-enrollment, when `complete` / `activateMfa` decrypt the
 *     secret to check the first code.
 *   - ACTIVE: an already-enrolled admin authenticating, when `login` /
 *     `assertStepUp` decrypt the secret to check a code.
 * Both must repair, or the enrolled case keeps the previous key required
 * indefinitely. Hence a shared helper rather than logic inlined at one site.
 *
 * CONTRACT (each clause is load-bearing)
 * -------------------------------------
 *  - PRECONDITION: the caller has ALREADY decrypted the existing ciphertext with
 *    an explicitly configured legacy key. This helper never decides to repair on
 *    its own, and never repairs material it could not authenticate.
 *  - WRITE: the SAME secret, re-sealed with the ACTIVE key. The plaintext exists
 *    only in this process's memory and is never persisted or logged in the clear.
 *  - CAS ON THE OBSERVED OLD VALUE: the UPDATE matches only if the row still
 *    holds the exact ciphertext/nonce the caller decrypted. Two concurrent
 *    repairs of the same row therefore cannot both land, and a repair can never
 *    clobber a *newer* secret written in between (for example, a reissued
 *    enrollment that legitimately replaced the pending material).
 *  - STATE CHANGE: NONE. Status, activated_at and last_accepted_totp_counter are
 *    untouched. The enrollment is never recreated, and no activation token is
 *    read, required, or consumed -- repair is invisible to the lifecycle.
 *  - NO SCHEMA CHANGE: it updates columns the schema already has.
 *
 * BEST-EFFORT BY CONTRACT, AND WHY A LOST RACE IS SUCCESS
 * ------------------------------------------------------
 * This never throws and its return value is advisory. A `false` result means
 * either "another writer repaired it first" or "the row moved on" -- and in both
 * cases the caller's request has ALREADY succeeded on its own terms: the TOTP
 * code was verified against a secret that is still the right secret. Turning
 * that into an authentication or activation failure would be a false negative
 * created purely by a background optimisation, which is exactly the class of
 * defect this work exists to remove. A storage fault is likewise swallowed: an
 * unrepaired row is a slow key retirement, never a failed login.
 */
export interface MfaSecretCiphertextRepair {
  compareAndSwapMfaSecretCiphertext(input: {
    adminId: string;
    expectedCiphertext: Buffer;
    expectedNonce: Buffer;
    ciphertext: Buffer;
    nonce: Buffer;
  }): Promise<boolean>;
}

export interface MfaSecretRepairRequest {
  adminId: string;
  keyring: MfaEncryptionKeyring;
  /** The ciphertext/nonce pair this request actually decrypted. */
  observedCiphertext: Buffer;
  observedNonce: Buffer;
  /** That same secret, in memory only, for re-sealing under the active key. */
  secret: Buffer;
}

/**
 * Re-seals a legacy-sealed MFA secret under the active key, guarded by a
 * compare-and-swap on the observed old value.
 *
 * @returns true only when this call performed the repair.
 */
export async function repairMfaSecretCiphertext(
  repository: MfaSecretCiphertextRepair,
  request: MfaSecretRepairRequest,
): Promise<boolean> {
  try {
    // Re-sealed with the ACTIVE key: this is what actually retires a legacy key.
    const reSealed = encryptTotpSecret(request.secret, request.keyring.active);
    return await repository.compareAndSwapMfaSecretCiphertext({
      adminId: request.adminId,
      expectedCiphertext: request.observedCiphertext,
      expectedNonce: request.observedNonce,
      ciphertext: reSealed.ciphertext,
      nonce: reSealed.nonce,
    });
  } catch {
    // Deliberately swallowed -- see BEST-EFFORT BY CONTRACT above. No error
    // detail is surfaced because a storage error here can carry row data, and
    // none of it is needed to serve the request that is already succeeding.
    return false;
  }
}
