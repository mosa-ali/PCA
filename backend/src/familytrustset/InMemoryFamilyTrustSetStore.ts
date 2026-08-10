import type { FamilyTrustSetEpoch } from './types.js';
import type { FamilyTrustSetStore } from './FamilyTrustSetStore.js';

/**
 * In-memory reference FamilyTrustSetStore. Ordinary bookkeeping, not a
 * crypto-sensitive choice -- a real, usable default, not a test-only
 * stand-in. Production device storage may substitute a persistent
 * implementation of the same interface (the current epoch must survive
 * app restarts on a real device).
 */
export class InMemoryFamilyTrustSetStore implements FamilyTrustSetStore {
  private current: FamilyTrustSetEpoch | null = null;

  getCurrentEpoch(): FamilyTrustSetEpoch | null {
    return this.current;
  }

  setCurrentEpoch(epoch: FamilyTrustSetEpoch): void {
    this.current = epoch;
  }
}
