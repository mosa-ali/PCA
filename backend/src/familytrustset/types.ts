export type OpaqueFamilyId = string;
export type OpaqueDeviceId = string;
export type KeyId = string;

/** The four family roles doc 02 Section 3 defines. PCA-FR-002A: a family MUST have exactly one ACTIVE OWNER entry at any time -- enforced by FamilyTrustSetEngine, not merely documented here. */
export type FamilyRole = 'OWNER' | 'ADMINISTRATOR' | 'VIEWER' | 'CHILD';

/** Per-entry membership status, exactly as doc 09 Section 3.2 lists. Distinct from src/device's DeviceStatus (device lifecycle) -- this is trust-set MEMBERSHIP status, a different concern the same physical device can independently have. */
export type TrustSetEntryStatus =
  | 'ACTIVE'
  | 'ROTATION_PENDING'
  | 'DEVICE_OFFLINE'
  | 'REVOKED'
  | 'EPOCH_STALE'
  | 'RECOVERY_REQUIRED';

/**
 * One family device's membership record within a trust-set epoch (doc 09
 * Section 3.2). DSK and DEK are always distinct key material for the same
 * entry (see policy.ts's isDistinctKeyPair) -- never interchangeable,
 * mirroring the same DSK/DEK role separation enforced server-side in
 * src/device and src/deviceauth.
 */
export interface FamilyTrustSetEntry {
  deviceId: OpaqueDeviceId;
  role: FamilyRole;
  dskKeyId: KeyId;
  dskPublicKey: string;
  dekKeyId: KeyId;
  dekPublicKey: string;
  status: TrustSetEntryStatus;
}

/**
 * One signed, versioned Family Trust Set epoch (doc 09 Section 3.2): "a
 * signed, versioned family object, not a server ACL." This module NEVER
 * resolves this from a server; it is the RECEIVING DEVICE's own local
 * state (PCA-SEC-017: "every device MUST independently verify... against
 * its own locally-held copy of the family trust set").
 *
 * `supersedesEpoch` is lineage/audit metadata only -- acceptance does NOT
 * require exact N -> N+1 chaining (see FamilyTrustSetEngine), since a
 * device that was offline through several rotations must be able to adopt
 * the latest epoch directly on reconnect (doc 09 Section 3.5/PCA-SEC-020).
 * `null` only for the genesis epoch (no prior epoch exists).
 *
 * Doc 09 Section 3.2 also lists an "authorization rule" field and permits
 * "signature(s)" (plural, for the Section 10 recovery-transaction path).
 * Neither is modeled here -- the doc does not specify the authorization
 * rule's concrete shape, and multi-signer recovery authorization is
 * Section 10's own separate workstream. This slice implements only the
 * ordinary single-owner-DSK-signs-the-next-epoch path; recovery-signed
 * epochs are deliberately out of scope, not silently mishandled (a
 * recovery-authorized signer that isn't the previous epoch's OWNER will
 * correctly fail this engine's INVALID_SIGNATURE check until a dedicated
 * recovery-transaction acceptance path is built).
 */
export interface FamilyTrustSetEpoch {
  familyId: OpaqueFamilyId;
  trustSetEpoch: number;
  keyEpoch: number;
  entries: FamilyTrustSetEntry[];
  issuedAt: Date;
  supersedesEpoch: number | null;
  /** Signature over the entire epoch (see canonicalize.ts) by the previous epoch's ACTIVE OWNER DSK, or self-certified by the claimed OWNER for the genesis epoch. Opaque; verified only via an injected TrustSetSignatureVerifier. */
  signature: string;
}
