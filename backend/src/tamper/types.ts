export type OpaqueFamilyId = string;
export type OpaqueDeviceId = string;
export type TamperEventId = string;

/**
 * Doc 21 Section 2's state table, verbatim. Tamper detection is a RISK
 * SIGNAL, never a verdict: doc 21 Section 1 is explicit that a detected
 * condition MUST NOT "accuse the child, delete data automatically, lock
 * out the parent, or silently change a family policy." Every function in
 * this module that computes or transitions a TamperState must uphold that
 * -- this module never deletes anything, never mutates policy content,
 * and its only lockout-adjacent behavior (repeated-failed-step-up rate
 * limiting) throttles authentication ATTEMPTS, never removes the parent's
 * eventual ability to authenticate.
 */
export type TamperState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'SUSPECTED_TAMPER'
  | 'RECOVERY_REQUIRED'
  | 'EPOCH_STALE'
  | 'DEVICE_OFFLINE'
  | 'REVOKED';

export type TamperSeverity = 'INFO' | 'ACTION_REQUIRED' | 'SECURITY_CRITICAL';

/**
 * Doc 21 Section 3/4's condition list. Every entry here maps to exactly
 * one doc 21 Section 3 table row (see policy.ts's CONDITION_POLICY) --
 * this type is the union of "reliable signals" the task brief requires
 * handling, not an attempt at a comprehensive compromise taxonomy (doc 21
 * Section 1: "PCA reports that limitation rather than promising
 * tamper-proof operation").
 */
export type TamperCondition =
  | 'USAGE_PERMISSION_LOST'
  | 'NOTIFICATION_CAPABILITY_LOST'
  | 'LOCATION_CAPABILITY_LOST'
  | 'VPN_FILTER_CAPABILITY_LOST'
  | 'DPC_AUTHORITY_LOST'
  | 'INVALID_ENVELOPE'
  | 'REPLAYED_ENVELOPE'
  | 'EXPIRED_ENVELOPE'
  | 'WRONG_TRUST_OR_KEY_EPOCH'
  | 'UNAUTHORIZED_SENDER'
  | 'CLOCK_ROLLBACK'
  | 'REPEATED_FAILED_PARENT_STEP_UP'
  | 'PACKAGE_RELEASE_INTEGRITY_MISMATCH'
  | 'HARDWARE_KEY_ASSURANCE_LOST'
  | 'RECOVERY_MATERIAL_OR_DEVICE_SUSPECTED_STOLEN';

/**
 * How much a single event's `evidenceClass` may say about WHY a condition
 * fired, without ever carrying doc 09 Section 5.2-forbidden content. This
 * is a closed, deliberately coarse vocabulary -- "which permission" or
 * "which capability," never a URL, location, keystroke, screenshot, or
 * recovery secret (doc 21 Section 2).
 */
export type TamperEvidenceClass =
  | 'PLATFORM_CAPABILITY_CALLBACK'
  | 'PLATFORM_SELF_CHECK'
  | 'ENVELOPE_VERIFICATION_FAILURE'
  | 'TRUSTED_TIME_HIGH_WATER_MARK'
  | 'LOCAL_RATE_LIMIT_AUDIT'
  | 'INTEGRITY_CHECK'
  | 'DEFENSE_IN_DEPTH_HEURISTIC'
  | 'PARENT_DECLARATION';

export type TamperEventStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

/**
 * Doc 21 Section 2's exact event contract: "eventId, deviceId,
 * trustSetEpoch, keyEpoch, UTC detection time, condition, severity,
 * evidenceClass, localSequence, status, and a signed, encrypted detail
 * payload." `detailCiphertext` is deliberately opaque `Buffer | null`
 * here (`null` only when a condition genuinely has no detail beyond the
 * typed fields already on this record) -- this module never generates,
 * inspects, or requires plaintext detail content; encrypting it is the
 * caller's job via the existing doc 09 envelope machinery
 * (src/familyenvelope), never reinvented here.
 */
export interface TamperEvent {
  eventId: TamperEventId;
  familyId: OpaqueFamilyId;
  deviceId: OpaqueDeviceId;
  trustSetEpoch: number;
  keyEpoch: number;
  detectedAtUtc: Date;
  condition: TamperCondition;
  severity: TamperSeverity;
  evidenceClass: TamperEvidenceClass;
  /** Monotonic per-device sequence, independent of trustSetEpoch/keyEpoch -- orders this device's own tamper-event stream for local audit/UI purposes (doc 21 Section 2), not a replay-protection nonce (that is src/familyenvelope's job for the TAMPER_ALERT envelope itself). */
  localSequence: number;
  status: TamperEventStatus;
  /** Opaque, signed+encrypted detail payload (doc 21 Section 2) -- see the class doc comment above. Never inspected by this module. */
  detailCiphertext: Buffer | null;
}
