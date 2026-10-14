import type { DeviceSessionRecord, ValidateDeviceSessionResult } from './types.js';
import { isSupportedChallengeTime } from '../deviceauth/policy.js';

export interface DeviceSessionRepository {
  create(record: DeviceSessionRecord): Promise<void>;
  validate(tokenHash: string, now: Date): Promise<ValidateDeviceSessionResult>;
  /** Atomically marks an unrevoked token and returns true only for that transition. */
  revoke(tokenHash: string, now: Date): Promise<boolean>;
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
  /** Expiry min-heap keeps process-local bearer records bounded without a full-map sweep per issuance. */
  private readonly expiryQueue: Array<{ tokenHash: string; sessionId: string; expiresAtMs: number }> = [];

  async create(record: DeviceSessionRecord): Promise<void> {
    const captured = cloneSession(record);
    if (!isValidSessionRecord(captured) ||
        captured.expiresAt.getTime() <= captured.issuedAt.getTime() ||
        (captured.revokedAt !== null && !isSupportedChallengeTime(captured.revokedAt))) {
      throw new RangeError('Device session timestamps are invalid.');
    }
    this.pruneExpired(captured.issuedAt.getTime());
    this.byTokenHash.set(captured.tokenHash, captured);
    this.pushExpiry({ tokenHash: captured.tokenHash, sessionId: captured.sessionId, expiresAtMs: captured.expiresAt.getTime() });
  }

  async validate(tokenHash: string, now: Date): Promise<ValidateDeviceSessionResult> {
    if (!isSupportedChallengeTime(now)) return { outcome: 'INVALID' };
    const record = this.byTokenHash.get(tokenHash);
    if (!record || !isValidSessionRecord(record)) return { outcome: 'INVALID' };
    this.pruneExpired(now.getTime());
    if (this.byTokenHash.get(tokenHash) !== record || record.revokedAt !== null ||
        now.getTime() < record.issuedAt.getTime() || now.getTime() >= record.expiresAt.getTime()) {
      return { outcome: 'INVALID' };
    }
    return { outcome: 'VALID', session: cloneSession(record) };
  }

  async revoke(tokenHash: string, now: Date): Promise<boolean> {
    if (!isSupportedChallengeTime(now)) return false;
    const record = this.byTokenHash.get(tokenHash);
    if (!record || !isValidSessionRecord(record) || record.revokedAt !== null ||
        now.getTime() < record.issuedAt.getTime()) return false;
    this.pruneExpired(now.getTime());
    if (this.byTokenHash.get(tokenHash) !== record) return false;
    record.revokedAt = new Date(now.getTime());
    // Revoke is an immediate terminal transition. The expiration heap entry
    // is a harmless tombstone and is guarded by sessionId/expiry on pop.
    this.byTokenHash.delete(tokenHash);
    return true;
  }

  private pruneExpired(nowMs: number): void {
    while (this.expiryQueue[0] && this.expiryQueue[0].expiresAtMs <= nowMs) {
      const expired = this.popExpiry()!;
      const record = this.byTokenHash.get(expired.tokenHash);
      if (record?.sessionId === expired.sessionId && record.expiresAt.getTime() === expired.expiresAtMs &&
          record.expiresAt.getTime() <= nowMs) {
        this.byTokenHash.delete(expired.tokenHash);
      }
    }
  }

  private pushExpiry(entry: { tokenHash: string; sessionId: string; expiresAtMs: number }): void {
    const queue = this.expiryQueue;
    queue.push(entry);
    let index = queue.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (queue[parent]!.expiresAtMs <= entry.expiresAtMs) break;
      queue[index] = queue[parent]!;
      index = parent;
    }
    queue[index] = entry;
  }

  private popExpiry(): { tokenHash: string; sessionId: string; expiresAtMs: number } | undefined {
    const queue = this.expiryQueue;
    const first = queue[0];
    const last = queue.pop();
    if (!first || !last || queue.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= queue.length) break;
      const right = left + 1;
      const child = right < queue.length && queue[right]!.expiresAtMs < queue[left]!.expiresAtMs ? right : left;
      if (queue[child]!.expiresAtMs >= last.expiresAtMs) break;
      queue[index] = queue[child]!;
      index = child;
    }
    queue[index] = last;
    return first;
  }
}

function cloneSession(record: DeviceSessionRecord): DeviceSessionRecord {
  return {
    ...record,
    issuedAt: new Date(record.issuedAt.getTime()),
    expiresAt: new Date(record.expiresAt.getTime()),
    revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt.getTime()),
  };
}

function isValidSessionRecord(record: DeviceSessionRecord): boolean {
  return isSupportedChallengeTime(record.issuedAt) &&
    isSupportedChallengeTime(record.expiresAt) &&
    record.expiresAt.getTime() > record.issuedAt.getTime() &&
    Number.isSafeInteger(record.familySessionEpoch) && record.familySessionEpoch >= 0 && record.familySessionEpoch <= 0xffff_ffff &&
    (record.revokedAt === null || isSupportedChallengeTime(record.revokedAt));
}
