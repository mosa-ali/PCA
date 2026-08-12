import type { DeviceSessionRecord, ValidateDeviceSessionResult } from './types.js';

export interface DeviceSessionRepository {
  create(record: DeviceSessionRecord): Promise<void>;
  validate(tokenHash: string, now: Date): Promise<ValidateDeviceSessionResult>;
  revoke(tokenHash: string, now: Date): Promise<void>;
}

/**
 * Process-local, non-durable session store -- deliberately not backed by a
 * new DB table (see types.ts's DeviceSessionRecord doc: losing a session on
 * restart only costs a cheap re-authentication, never data). Good enough
 * for a single backend process; a multi-instance deployment would need a
 * shared store, out of scope for this lane (no schema change without an
 * owner decision -- see docs/architecture PCA schema governance protocol).
 */
export class InMemoryDeviceSessionRepository implements DeviceSessionRepository {
  private readonly byTokenHash = new Map<string, DeviceSessionRecord>();

  async create(record: DeviceSessionRecord): Promise<void> {
    this.byTokenHash.set(record.tokenHash, { ...record });
  }

  async validate(tokenHash: string, now: Date): Promise<ValidateDeviceSessionResult> {
    const record = this.byTokenHash.get(tokenHash);
    if (!record) return { outcome: 'INVALID' };
    if (record.revokedAt) return { outcome: 'INVALID' };
    if (now.getTime() >= record.expiresAt.getTime()) return { outcome: 'INVALID' };
    return { outcome: 'VALID', session: { ...record } };
  }

  async revoke(tokenHash: string, now: Date): Promise<void> {
    const record = this.byTokenHash.get(tokenHash);
    if (record && !record.revokedAt) record.revokedAt = now;
  }
}
