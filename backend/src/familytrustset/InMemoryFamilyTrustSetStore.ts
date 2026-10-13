import type { FamilyTrustSetEpoch } from './types.js';
import type { FamilyTrustSetStore } from './FamilyTrustSetStore.js';

/** In-memory reference store. Production device storage must survive restarts. */
export class InMemoryFamilyTrustSetStore implements FamilyTrustSetStore {
  private current: FamilyTrustSetEpoch | null = null;

  getCurrentEpoch(): FamilyTrustSetEpoch | null {
    return this.current === null ? null : snapshotEpoch(this.current);
  }

  setCurrentEpoch(epoch: FamilyTrustSetEpoch): void {
    this.current = snapshotEpoch(epoch);
  }
}

function snapshotEpoch(epoch: FamilyTrustSetEpoch): FamilyTrustSetEpoch {
  return {
    familyId: epoch.familyId,
    trustSetEpoch: epoch.trustSetEpoch,
    keyEpoch: epoch.keyEpoch,
    entries: epoch.entries.map((entry) => ({
      deviceId: entry.deviceId,
      role: entry.role,
      dskKeyId: entry.dskKeyId,
      dskPublicKey: entry.dskPublicKey,
      dekKeyId: entry.dekKeyId,
      dekPublicKey: entry.dekPublicKey,
      status: entry.status,
    })),
    issuedAt: new Date(epoch.issuedAt.getTime()),
    supersedesEpoch: epoch.supersedesEpoch,
    signature: epoch.signature,
  };
}
