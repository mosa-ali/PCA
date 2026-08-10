export type ServiceAccountId = string;
export type ServiceSessionId = string;

/**
 * Output of an upstream, provider-neutral identity verification step (an
 * identity provider / passkey / platform authentication integration).
 * accountReferenceHash is an opaque one-way hash of whatever the provider
 * asserted (never a raw email, username, or credential) -- this module
 * never sees or stores a raw identity.
 */
export interface VerifiedIdentity {
  accountReferenceHash: Buffer;
}

export interface ServiceAccountRecord {
  accountId: ServiceAccountId;
  accountReferenceHash: Buffer;
  createdAt: Date;
  disabledAt: Date | null;
}

/**
 * SERVICE CONTROL-PLANE session only -- this is not, and must never become,
 * family E2EE authority. A valid session proves "this is a recognized
 * service account," nothing about Owner/Administrator/Viewer/Child role,
 * which lives entirely in the device-side Family Trust Set.
 */
export interface ServiceSessionRecord {
  sessionId: ServiceSessionId;
  accountId: ServiceAccountId;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
