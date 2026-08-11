/**
 * Enforces that a `recoveryTransactionId` (doc 09 Section 10: "Relay
 * accepts each transaction ID once") authorizes at most one accepted
 * recovery epoch, ever. `claimTransaction` is a SINGLE atomic operation,
 * not a separate check-then-write pair: a check-then-write pair leaves a
 * race window in which two concurrent recovery attempts for the same
 * transaction id can both observe "not yet used" and both proceed,
 * defeating one-time semantics exactly the way a naive
 * isUsed()+markUsed() parent-authorization check would (see the PCA-3
 * lane's NF-002 fix for the identical defect in a different domain). A
 * durable implementation (e.g. a SQL `INSERT ... ON CONFLICT DO NOTHING`
 * keyed on `recoveryTransactionId`) MUST preserve that same atomicity.
 *
 * This is intentionally a SEPARATE ledger from
 * src/familyenvelope/MessageIdempotencyLedger.ts: a recovery transaction
 * ID is a family-lifecycle-level, cross-envelope concern (one recovery
 * transaction may involve multiple envelope deliveries/receipts), not a
 * single envelope's `messageId`.
 */
export interface RecoveryTransactionLedger {
  /**
   * Atomically attempts to claim `recoveryTransactionId` for one-time use.
   *
   * @returns `true` if this call is the one that claimed it; `false` if it
   * was already claimed -- by this call or any other, concurrent or
   * prior. A `false` result is permanent: the id never becomes claimable
   * again.
   */
  claimTransaction(recoveryTransactionId: string): Promise<boolean>;
}

/**
 * In-memory reference implementation. A JavaScript `Map`'s single-threaded
 * event loop makes `has`+`set` atomic with respect to OTHER synchronous
 * code, but `claimTransaction` is still declared `async` (matching the
 * interface) so a durable implementation's real I/O latency is exercised
 * by the same call shape in tests -- callers must not assume this
 * resolves synchronously.
 */
export class InMemoryRecoveryTransactionLedger implements RecoveryTransactionLedger {
  private readonly claimed = new Set<string>();

  async claimTransaction(recoveryTransactionId: string): Promise<boolean> {
    if (this.claimed.has(recoveryTransactionId)) return false;
    this.claimed.add(recoveryTransactionId);
    return true;
  }
}
