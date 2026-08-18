export type Platform = 'ANDROID' | 'IOS';

import type { AgeUxTier, InitialPolicyProfile } from '../invitation/types.js';

export interface EnrollDeviceInput {
  rawInvitationToken: string;
  platform: Platform;
  /** Device Signing Key public half -- doc 09 Section 3.1. Never used for key agreement. */
  signingPublicKey: string;
  /** Device Encryption/Key-Agreement Key public half -- doc 09 Section 3.1. Never used to sign. */
  encryptionPublicKey: string;
  /**
   * Client-generated, high-entropy, NON-secret correlator for retries of one
   * logical enrollment attempt (PCA-ENROLLMENT-RUNTIME-2). Never itself an
   * authority -- see attempt.ts.
   */
  attemptId: string;
  /**
   * Client-generated, high-entropy SECRET, distinct from the invitation
   * token, that proves a later recovery caller is the same party that made
   * this request. The server stores only its hash. See attempt.ts.
   */
  attemptRecoveryToken: string;
}

/**
 * A claimed invitation with device identity and keys recorded --
 * PAIRING_PENDING, not ACTIVE or "enrolled" in the trusted sense. Parent
 * confirmation (PairingService.confirmPairing) and, later, first-policy
 * delivery via the Family Trust Set are still required before this device
 * is ACTIVE (doc 08 Section 3).
 */
export interface EnrollDeviceResult {
  deviceId: string;
  signingKeyId: string;
  encryptionKeyId: string;
  familyId: string;
  invitationId: string;
  childProfileId: string | null;
  ageUxTier: AgeUxTier;
  initialPolicyProfile: InitialPolicyProfile;
  status: 'PAIRING_PENDING';
}

/** Input to EnrollmentCoordinator.recoverAttempt -- see EnrollmentCoordinator.ts. */
export interface RecoverAttemptInput {
  attemptId: string;
  attemptRecoveryToken: string;
}

/** Same shape as a successful bootstrap so the HTTP layer can reuse one DTO for both. */
export interface RecoverAttemptResult {
  deviceId: string;
  childProfileId: string | null;
  ageUxTier: AgeUxTier;
  initialPolicyProfile: InitialPolicyProfile;
  status: 'PAIRING_PENDING';
}
