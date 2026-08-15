// DeviceEnrollmentClient -- the browser-side port for the child-device
// enrollment control plane (invitation issuance/status/revocation and
// pairing-request confirmation). This is deliberately NOT part of
// ParentFamilyDataGateway: it never carries decrypted family-activity
// content (screen time, location, app rules, etc.) -- only enrollment
// control metadata (invitation lifecycle, pairing status, key
// fingerprints). See backend/src/http/routes/invitationRoutes.ts and
// backend/src/http/routes/pairingRoutes.ts for the verified server
// contract this interface mirrors field-for-field.
//
// Field/behavior invariants this interface exists to preserve for every
// implementation (Dev fixture, Real HTTP, and any future variant):
//  - `rawInvitationToken` is present ONLY on the object returned by
//    createInvitation(). It is never returned by getInvitation/
//    listInvitations/revokeInvitation, and no implementation may cache or
//    replay a previously seen raw token from those calls.
//  - confirmPairing() can only ever move a pairing request from
//    PAIRING_PENDING to PAIRED (idempotent), or reject; it can NEVER
//    surface a status of ACTIVE -- ACTIVE is a distinct, later lifecycle
//    stage this interface has no operation for. See
//    backend/src/pairing/PairingService.ts doc comment.

export type InvitationPlatform = 'ANDROID' | 'IOS';
export type RequestedProtectionMode = 'ANDROID_STANDARD' | 'ANDROID_PROTECTED' | 'IOS_STANDARD';

/** Explicit, allowlisted DTO shape mirroring backend/src/http/dto.ts InvitationDto exactly. */
export interface InvitationDto {
  invitationId: string;
  familyId: string;
  platform: InvitationPlatform;
  requestedProtectionMode: RequestedProtectionMode;
  status: string;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  /** PCA-ADD-ENR-005 (Addendum 001 8-state lifecycle): real, persisted, audited transitions -- see InvitationService.ts. */
  installRequiredAt: string | null;
  appInstalledAt: string | null;
  authorizationRequiredAt: string | null;
  redeemedAt: string | null;
  expiredAt: string | null;
  revokedAt: string | null;
}

/** rawInvitationToken is present ONLY on the creation response -- see file header. */
export interface InvitationCreatedDto extends InvitationDto {
  rawInvitationToken: string;
}

/** Mirrors backend/src/http/dto.ts PairingRequestDto exactly. Never carries private key material -- the backend itself never sends it. */
export interface PairingRequestDto {
  deviceId: string;
  platform: string;
  status: string;
  dskFingerprint: string | null;
  dekFingerprint: string | null;
}

export interface CreateInvitationInput {
  platform: InvitationPlatform;
  requestedProtectionMode: RequestedProtectionMode;
  /** Optional custom time-to-live in milliseconds; omitted uses the backend's default. */
  ttlMs?: number;
}

export type DeviceEnrollmentErrorCode =
  | 'INVALID_REQUEST' // 400
  | 'UNAUTHORIZED' // 401 -- expired/missing service session
  | 'FORBIDDEN' // 403 -- real RBAC rejection from AuthzService, not a client guess
  | 'NOT_FOUND' // 404
  | 'CONFLICT' // 409 -- e.g. confirming an already-PAIRED or REVOKED pairing target
  | 'RATE_LIMITED' // 429
  | 'NETWORK_ERROR' // fetch threw / offline
  | 'SERVICE_SESSION_UNAVAILABLE' // no bearer token available to attach -- see realDeviceEnrollmentClient.ts
  | 'UNKNOWN';

export class DeviceEnrollmentError extends Error {
  readonly code: DeviceEnrollmentErrorCode;
  readonly httpStatus: number | null;

  constructor(code: DeviceEnrollmentErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'DeviceEnrollmentError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface DeviceEnrollmentClient {
  /**
   * Creates a new child-device invitation. The returned object's
   * rawInvitationToken is the ONLY time the raw bearer token is ever
   * visible to this client -- callers must render/copy it immediately and
   * must never attempt to refetch it later (getInvitation/listInvitations
   * never return it, matching the server).
   */
  createInvitation(familyId: string, input: CreateInvitationInput): Promise<InvitationCreatedDto>;
  getInvitation(familyId: string, invitationId: string): Promise<InvitationDto>;
  listInvitations(familyId: string): Promise<InvitationDto[]>;
  revokeInvitation(familyId: string, invitationId: string): Promise<InvitationDto>;
  getPairingRequest(familyId: string, deviceId: string): Promise<PairingRequestDto>;
  /**
   * Confirms a pending pairing request. Only ever transitions
   * PAIRING_PENDING -> PAIRED (idempotent); an already-PAIRED or REVOKED
   * target surfaces DeviceEnrollmentError('CONFLICT'). The resolved status
   * must be rendered as PAIRED, never as ACTIVE.
   */
  confirmPairing(familyId: string, deviceId: string): Promise<PairingRequestDto>;
}
