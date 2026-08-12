export type DeviceSessionId = string;

/**
 * Short-lived, opaque device session -- the piece DeviceAuthService's own
 * doc comment explicitly defers ("composing that on top ... is a separate,
 * later concern"). Deliberately session-only, not durable across a backend
 * restart: losing it merely costs the device one more cheap DSK
 * challenge/response round-trip, never any data. No new DB table/migration.
 */
export interface DeviceSessionRecord {
  sessionId: DeviceSessionId;
  tokenHash: string;
  deviceId: string;
  familyId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type ValidateDeviceSessionResult =
  | { outcome: 'VALID'; session: DeviceSessionRecord }
  | { outcome: 'INVALID' };
