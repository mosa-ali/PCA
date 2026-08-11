import type { EnvelopeSignatureVerifier } from './EnvelopeSignatureVerifier.js';
import type { FamilyEnvelope, FamilyEnvelopeMessageType, OpaqueDeviceId, SenderKeyId } from './types.js';

/**
 * doc 22 PCA-API-002 lists the FULL receiver-side check pipeline:
 *
 *   parse/schema bounds; protocol compatibility; FTS/key lookup;
 *   sender role; signature; anti-replay; expiry; trust/key epoch;
 *   semantic ordering; decrypt/authenticate payload; payload schema
 *   and authorization.
 *
 * This module (FamilyEnvelopeVerifier.evaluateEnvelope, plus parse.ts)
 * implements: parse/schema bounds, protocol compatibility, signature
 * (verification only -- key resolution is external), anti-replay,
 * expiry, trust/key epoch, and semantic ordering.
 *
 * It deliberately does NOT implement:
 *   - FTS/key lookup (resolving `senderKeyId` to a public key + role) --
 *     that is src/familytrustset's job; this module only ever receives
 *     an already-resolved `senderPublicKey` via EnvelopeAcceptanceContext.
 *   - sender role authorization (e.g. "is this senderKeyId's role even
 *     allowed to send this messageType") -- requires FTS role data and a
 *     doc 02/18 RBAC policy, neither of which this protocol-neutral core
 *     owns.
 *   - decrypt/authenticate payload -- requires a concrete AEAD/KEM
 *     construction, gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW.
 *   - payload schema and authorization -- requires the decrypted payload,
 *     which this module never produces (payload stays opaque throughout).
 *
 * These four interfaces below give the REMAINING pipeline stages a
 * documented, testable shape -- so a future caller can compose the full
 * pipeline by implementing them -- without this module choosing any
 * concrete FTS storage, RBAC policy, or cryptographic construction.
 * Interfaces and state-transition LOGIC are authorized now; concrete
 * signature math, AEAD, KDF, and KEM selection remain
 * WAITING_HUMAN_SECURITY_REVIEW regardless of how these interfaces are
 * eventually implemented.
 */

/** FTS/key lookup: resolves a claimed senderKeyId to the currently-trusted signing key and the sender's family role, or null if unknown/not currently trusted. Implemented by a future caller composing this module with src/familytrustset. */
export interface SenderKeyResolver {
  resolve(familyId: string, senderKeyId: SenderKeyId): Promise<ResolvedSenderKey | null>;
}

export interface ResolvedSenderKey {
  publicKey: string;
  role: 'OWNER' | 'ADMINISTRATOR' | 'VIEWER' | 'CHILD';
  deviceId: OpaqueDeviceId;
}

/** Sender-role authorization: given a resolved sender's role and the envelope's messageType, decides whether that role is authorized to send that type at all (doc 02 Section 3 roles, doc 18 RBAC). Independent of, and checked separately from, signature validity -- a validly-signed message from an unauthorized role must still be rejected. */
export interface SenderRoleAuthorizer {
  isAuthorized(role: ResolvedSenderKey['role'], messageType: FamilyEnvelopeMessageType): boolean;
}

/** Decrypt/authenticate the opaque payload under the family's current FDEK material. Returns null on any authentication failure -- never partial/best-effort plaintext. Concrete AEAD construction is WAITING_HUMAN_SECURITY_REVIEW; this interface only fixes the shape callers compose against. */
export interface PayloadDecryptor {
  decrypt(envelope: FamilyEnvelope): Promise<Buffer | null>;
}

/** Payload schema and authorization: once decrypted, the plaintext must still match the expected schema for `messageType` and satisfy any payload-level authorization rule (e.g. a POLICY_UPDATE's content only touching settings the sending role may set). Entirely out of this protocol-neutral core's scope -- it never sees decrypted content. */
export interface PayloadSchemaAuthorizer {
  isAuthorized(messageType: FamilyEnvelopeMessageType, plaintext: Buffer): boolean;
}

/**
 * Optional, fully-composed pipeline shape a future caller MAY implement
 * by wiring EnvelopeSignatureVerifier (this module) together with the
 * four stages above. Exported purely as a documented contract -- this
 * module provides no implementation of it, and evaluateEnvelope does not
 * require one.
 */
export interface FullReceiverPipeline {
  senderKeyResolver: SenderKeyResolver;
  senderRoleAuthorizer: SenderRoleAuthorizer;
  signatureVerifier: EnvelopeSignatureVerifier;
  payloadDecryptor: PayloadDecryptor;
  payloadSchemaAuthorizer: PayloadSchemaAuthorizer;
}
