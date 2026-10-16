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
  /** Exact registered DSK whose proof established this process-local bearer session. */
  dskKeyId: string;
  /** Public key snapshot binds the bearer to immutable verified DSK material. */
  dskPublicKey: string;
  /** Authorization purpose; bootstrap sessions never authorize ACTIVE routes. */
  purpose: 'ACTIVE' | 'PAIRED_BOOTSTRAP';
  /** Bootstrap sessions are pinned to the one activation target generation they may read. */
  activationTargetGeneration: number | null;
  bootstrapChallengeId: string | null;
  /** Durable family lifecycle generation observed when this session was issued. */
  familySessionEpoch: number;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type ValidateDeviceSessionResult =
  | { outcome: 'VALID'; session: DeviceSessionRecord }
  | { outcome: 'INVALID' };
