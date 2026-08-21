export type DeviceId = string;
export type DeviceKeyId = string;
export type OpaqueFamilyId = string;
/**
 * BROWSER is a service-authenticated parent-web trusted-browser endpoint
 * (doc 08 Section 8-style ceremony), registered via
 * BrowserEndpointService/browserEndpointRoutes.ts -- NOT reachable through
 * EnrollmentCoordinator's invitation-claim flow, which remains
 * ANDROID/IOS-only child-device enrollment. A BROWSER device never has a
 * DEK: it registers exactly one DSK (the browser's non-extractable WebCrypto
 * signing key) and is never a family E2EE encryption recipient by itself.
 */
export type Platform = 'ANDROID' | 'IOS' | 'BROWSER';

/**
 * Device lifecycle per accepted architecture (doc 08 Section 3):
 * NEW -> INVITED -> PAIRED -> ACTIVE. This service layer starts at
 * PAIRING_PENDING (an invitation has been claimed and device keys
 * submitted -- "INVITED" resolving) rather than NEW/INVITED, since those
 * earlier states live entirely in the invitation domain. Enrollment-token
 * submission alone MUST produce PAIRING_PENDING, never PAIRED or ACTIVE:
 * PAIRED requires an authorized parent to confirm the submitted key
 * fingerprints (doc 08 PCA-FR-141), and ACTIVE requires first-policy
 * delivery via the Family Trust Set (doc 09), a later, FTS-dependent
 * phase not implemented here.
 */
export type DeviceStatus = 'PAIRING_PENDING' | 'PAIRED' | 'ACTIVE' | 'REVOKED';
export type DeviceKeyStatus = 'ACTIVE' | 'REVOKED';

/**
 * Per doc 09 Section 3.1: Device Signing Key (DSK) and Device
 * Encryption/Key-Agreement Key (DEK) are distinct roles that must never
 * collapse into one generic key pair. DSK signs trust-set epochs, policy
 * envelopes and receipts; DEK receives FDEK envelopes. Neither role is
 * ever used for the other's purpose.
 */
export type DeviceKeyPurpose = 'DSK' | 'DEK';

/**
 * Device identity record. Carries only opaque references and public-key
 * material -- public keys are not secret, but this record must never gain a
 * field for private keys, PINs, or family activity data.
 *
 * pairedAt/pairedByAccountId record SERVICE-side parent confirmation
 * bookkeeping only ("this account confirmed the fingerprint shown") -- this
 * is never family E2EE trust authority, which remains entirely device-side
 * in the Family Trust Set (doc 09 Section 3.2).
 *
 * registeredByAccountId records which service-session account requested a
 * BROWSER endpoint's registration -- null for every invitation-enrolled
 * (ANDROID/IOS) device, which has no service session at creation time.
 * confirmPairing rejects a confirmation from this SAME account
 * (SELF_APPROVAL_DENIED) -- the mechanical enforcement of "no self-approval"
 * for a ceremony where, unlike mobile enrollment, the registering and
 * confirming parties could otherwise trivially be the same session.
 */
export interface DeviceRecord {
  deviceId: DeviceId;
  familyId: OpaqueFamilyId;
  platform: Platform;
  status: DeviceStatus;
  createdAt: Date;
  revokedAt: Date | null;
  pairedAt: Date | null;
  pairedByAccountId: string | null;
  registeredByAccountId: string | null;
}

export interface DeviceKeyRecord {
  deviceId: DeviceId;
  keyId: DeviceKeyId;
  keyPurpose: DeviceKeyPurpose;
  publicKey: string;
  status: DeviceKeyStatus;
  createdAt: Date;
  revokedAt: Date | null;
}
