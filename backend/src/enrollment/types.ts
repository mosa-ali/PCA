export type Platform = 'ANDROID' | 'IOS';

export interface EnrollDeviceInput {
  rawInvitationToken: string;
  platform: Platform;
  /** Device Signing Key public half -- doc 09 Section 3.1. Never used for key agreement. */
  signingPublicKey: string;
  /** Device Encryption/Key-Agreement Key public half -- doc 09 Section 3.1. Never used to sign. */
  encryptionPublicKey: string;
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
  status: 'PAIRING_PENDING';
}
