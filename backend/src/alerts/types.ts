/**
 * PCA-ADD-ENR-020's closed event vocabulary. These are event categories,
 * not readable family-data descriptions. A caller may attach only an
 * already-encrypted payload to an event.
 */
export type ProtectionAlertTrigger =
  | 'DISABLE_OR_REMOVAL_REQUESTED'
  | 'REPEATED_INVALID_PIN'
  | 'AUTHORITY_CHANGE'
  | 'CRITICAL_PERMISSION_OR_VPN_LOST'
  | 'UNEXPECTED_OFFLINE'
  | 'TIME_TAMPERING'
  | 'PROTECTION_DEGRADED'
  | 'REINSTALLATION'
  | 'INVITATION_REDEEMED'
  | 'UNENROLLMENT';

export interface ProtectionAlertEvent {
  readonly alertId: string;
  readonly familyId: string;
  /** Invitation redemption may be emitted before a device is bound. */
  readonly deviceId: string | null;
  readonly parentDeviceId: string;
  readonly trigger: ProtectionAlertTrigger;
  readonly keyEpoch: number;
  readonly generatedAtUtc: Date;
  /** Opaque bytes produced by the trusted parent/device crypto boundary. */
  readonly encryptedPayloadB64: string;
  readonly nonceB64: string;
}
