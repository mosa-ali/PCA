import { decryptTotpSecretWithKeyring } from '../../dist/platformadmin/auth/totp.js';

/**
 * Pure classification logic for the MFA key-rotation drain audit.
 *
 * WHY THIS EXISTS (reviewer findings F1, HIGH, raised independently by both
 * Codex and Claude)
 * -------------------------------------------------------------------------
 * Read repair only runs when a row is DECRYPTED, which only happens when an
 * admin authenticates, activates, or completes an enrollment. So:
 *
 *   - an ACTIVE admin who simply does not log in across a rotation keeps their
 *     secret sealed under the previous key indefinitely, and
 *   - NOTHING tells an operator whether any such row still exists.
 *
 * The result is that clearing PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1 becomes a
 * blind act: retire it while a dormant row still needs it and that admin is
 * locked out of the operator plane with no authenticated way back in -- the
 * exact defect class the key ring was built to remove, reintroduced as an
 * operational trap. With two slots, an admin idle across two rotations is
 * locked out even sooner.
 *
 * This module answers the one question an operator must be able to ask before
 * retiring a key: "is anything still sealed under a previous generation, and is
 * anything unreadable?". The answer is COUNTS ONLY.
 *
 * THE SECRET-NEVER-LEAVES PROPERTY IS STRUCTURAL
 * ---------------------------------------------
 * `auditRow` returns the decrypted secret ONLY so the caller can re-seal it.
 * `summarize` reads nothing but `outcome` and `keySource`, so the value an
 * operator or a log can ever see is a count -- there is no field through which
 * an admin id, a ciphertext byte, a nonce, a plaintext secret or a key could
 * reach the output, even by mistake. The script never prints rows, only
 * summaries.
 *
 * Deliberately DB-free so the classification and the refusal contract can be
 * tested exhaustively without a database, following the same split as
 * scripts/lib/platformAdminRecoveryVerdict.mjs.
 */

/** What a single row's sealed secret turned out to be. */
export const DRAIN_OUTCOMES = ['ACTIVE', 'LEGACY', 'UNDECRYPTABLE'];

/**
 * Classifies one sealed secret against the configured key ring.
 *
 * @returns {{outcome: 'ACTIVE'|'LEGACY'|'UNDECRYPTABLE', keySource?: string, secret?: Buffer}}
 *   For LEGACY, `secret` is returned SOLELY so the caller can re-seal it under
 *   the active key. It must never be printed, logged, or persisted in the clear.
 */
export function auditRow({ ciphertext, nonce, keyring }) {
  if (!ciphertext || !nonce) return { outcome: 'UNDECRYPTABLE' };
  try {
    const { secret, keySource, requiresReadRepair } = decryptTotpSecretWithKeyring(ciphertext, nonce, keyring);
    return requiresReadRepair
      ? { outcome: 'LEGACY', keySource, secret }
      : { outcome: 'ACTIVE', keySource, secret };
  } catch {
    // No permitted key authenticated this row. Reported as a COUNT and nothing
    // else: an id paired with "unreadable" would still be operator-useful, but
    // the moment a row is identified the temptation to print it is real, and
    // count-only is the property that makes this output safe to paste anywhere.
    return { outcome: 'UNDECRYPTABLE' };
  }
}

/**
 * Aggregates classifications into counts. Structurally cannot carry a secret:
 * it only ever reads `outcome` and `keySource`.
 */
export function summarize(classifications) {
  const byKeySource = {};
  let undecryptable = 0;
  for (const classification of classifications) {
    if (classification.outcome === 'UNDECRYPTABLE') {
      undecryptable += 1;
      continue;
    }
    const source = classification.keySource;
    byKeySource[source] = (byKeySource[source] ?? 0) + 1;
  }
  const total = classifications.length;
  const active = byKeySource.ACTIVE ?? 0;
  return {
    total,
    byKeySource,
    /** Rows still sealed under a previous generation: the retirement blocker. */
    legacy: total - active - undecryptable,
    undecryptable,
  };
}

/**
 * Exit-code contract. A non-zero exit is the ONLY durable signal an operator
 * gets, so it must refuse to be green while a key is still load-bearing.
 *
 *   0  nothing depends on a previous key; retiring it is safe
 *   2  at least one row could not be decrypted with any permitted key
 *      (the most serious: data is already unreachable, and configuring more
 *      keys or restoring the correct one is the only remedy)
 *   3  at least one row is still sealed under a previous generation, so that
 *      key MUST stay configured
 */
export function exitCodeFor(summary) {
  if (summary.undecryptable > 0) return 2;
  if (summary.legacy > 0) return 3;
  return 0;
}

/** True when retiring a previous key is safe on this evidence. */
export function isRetirementSafe(summary) {
  return exitCodeFor(summary) === 0;
}
