import type { FamilyTrustSetEpoch } from './types.js';

/**
 * A receiving device's own locally-held current Family Trust Set epoch
 * (doc 09 Section 3.2/PCA-SEC-017). This is device-local state, never a
 * server-side source of truth -- the Relay only ever distributes opaque,
 * signed epoch objects; it does not adjudicate which one is current.
 */
export interface FamilyTrustSetStore {
  /**
   * `null` is load-bearing: FamilyTrustSetEngine.acceptEpoch treats `null`
   * as "no epoch has ever been stored" and switches to trust-on-first-use
   * signature verification (the candidate's own claimed owner self-certifies
   * -- see acceptEpoch's doc comment). Every implementation of this
   * interface MUST guarantee `null` is returned ONLY for that genuine
   * never-initialized state, and MUST NEVER return `null` as a result of a
   * transient read failure, a corrupted/partially-wiped local store, or
   * any other error condition once a real epoch has been persisted --
   * doing so would let an attacker (a malicious Relay, a network MITM,
   * anyone who can inject a candidate epoch) silently re-trigger
   * trust-on-first-use and self-certify a hostile epoch naming themselves
   * OWNER. A persistent implementation must raise/throw on a genuine read
   * failure, never fall back to `null`.
   */
  getCurrentEpoch(): FamilyTrustSetEpoch | null;
  /** Called ONLY by FamilyTrustSetEngine.acceptEpoch after full acceptance -- never on a rejected epoch. */
  setCurrentEpoch(epoch: FamilyTrustSetEpoch): void;
}
