import { runInTransaction } from '../../db/pool.js';
import type { ComplimentaryGrantRepository } from '../../entitlements/complimentary/ComplimentaryGrantRepository.js';
import type { OpaqueFamilyId } from '../../entitlements/types.js';
import { assertNewCapacityAllowed, deriveFreeAccessStatus } from './deriveFreeAccessStatus.js';
import type { FreeAccessAccountRepository } from './FreeAccessAccountRepository.js';

/**
 * The one production policy boundary for a new commercial-capability
 * acquisition. Legacy families without a parent-account FREE_ACCESS
 * snapshot remain compatible; verified parent accounts are evaluated from
 * their persisted snapshot at the server clock and fail closed on expiry.
 * An active complimentary COMMERCIAL_ACCESS grant is the explicit override
 * defined by Addendum 004, never a client-supplied flag.
 */
export interface NewCapacityAcquisitionPolicy {
  assertAllowed(familyId: OpaqueFamilyId, now: Date): Promise<void>;
}

export class FreeAccessAcquisitionPolicy implements NewCapacityAcquisitionPolicy {
  constructor(
    private readonly accountRepository: FreeAccessAccountRepository,
    private readonly complimentaryGrantRepository: ComplimentaryGrantRepository,
    private readonly runTx: typeof runInTransaction = runInTransaction,
  ) {}

  async assertAllowed(familyId: OpaqueFamilyId, now: Date): Promise<void> {
    const account = await this.accountRepository.findByFamilyId(familyId);
    if (!account?.freeAccess) return;

    const hasActiveCommercialAccess = await this.runTx((conn) =>
      this.complimentaryGrantRepository.sumActiveAmount(conn, familyId, 'COMMERCIAL_ACCESS', now).then((amount) => amount > 0),
    );
    assertNewCapacityAllowed(deriveFreeAccessStatus(account.freeAccess, now), hasActiveCommercialAccess);
  }
}
