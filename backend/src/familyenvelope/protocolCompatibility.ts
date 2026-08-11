import { SUPPORTED_PROTOCOL_MAJOR } from './policy.js';

/**
 * doc 22 Section 6 ("Compatibility and evolution"):
 *   - protocolMajor incompatibility: reject without decrypting/applying.
 *   - Higher unknown protocolMinor: accept only if required fields/types
 *     are known and signature coverage is preserved; ignore explicitly
 *     extensible unknown fields, never unknown security semantics.
 *
 * This receiver implements that second bullet structurally rather than
 * by tracking a separate "highest known minor" ceiling: parseFamilyEnvelope
 * (parse.ts) already requires every field THIS receiver understands to be
 * present and well-formed, and naturally ignores any additional unknown
 * wire fields a higher-minor sender might include (they are simply never
 * read). A minor bump can therefore only ever ADD optional/ignorable
 * wire content from this receiver's point of view -- if a future change
 * needs this receiver to understand a NEW REQUIRED field or altered
 * security semantics, that is by this doc's own definition a major-
 * version-worthy change, not a minor one, so it is already caught by the
 * major check below. Consequently, any protocolMinor value (0 or
 * higher, per policy.ts's isPlausibleProtocolMinor) is compatible once
 * protocolMajor matches.
 */
export function isProtocolCompatible(protocolMajor: number): boolean {
  return protocolMajor === SUPPORTED_PROTOCOL_MAJOR;
}
