import { randomUUID } from 'node:crypto';
import { execute, isDuplicateEntry, runInTransaction, SoftFailure } from '../../db/pool.js';
import { insertPlatformAdminAuditEventRow } from '../../platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { assertValidPriceBookVersion } from '../types.js';
import type { ChangeRequestRepository } from '../requests/ChangeRequestRepository.js';
import type { EntitlementRepository } from '../EntitlementRepository.js';
import type { PaymentConfirmationInput, PaymentConfirmationOutcome, PaymentConfirmationPort, PaymentConfirmationResult } from './PaymentConfirmationPort.js';

type SoftCode = Exclude<PaymentConfirmationOutcome, 'ACTIVATED'>;

/**
 * PCA-ADD-BILL-046: idempotent, at-most-once activation. The
 * `entitlement_activation_idempotency` table's PRIMARY KEY on
 * idempotency_key is the actual concurrency-safety mechanism -- two
 * concurrent/replayed calls with the same idempotencyKey race the same
 * INSERT; the loser gets ER_DUP_ENTRY (not a partially-applied entitlement
 * change, since the whole transaction, including any prior statements,
 * rolls back on that throw) and this method maps that to
 * ALREADY_ACTIVATED by re-reading the winner's already-committed row.
 *
 * PCA-ADD-PA-032: the request's APPROVED transition and the entitlement's
 * limit raise are committed in the SAME transaction as the idempotency
 * claim -- there is no window where the claim exists but the entitlement/
 * request state has not yet moved, or vice versa.
 */
export class PaymentConfirmationService implements PaymentConfirmationPort {
  private readonly changeRequestRepository: ChangeRequestRepository;
  private readonly entitlementRepository: EntitlementRepository;
  private readonly now: () => Date;

  constructor(changeRequestRepository: ChangeRequestRepository, entitlementRepository: EntitlementRepository, now: () => Date = () => new Date()) {
    this.changeRequestRepository = changeRequestRepository;
    this.entitlementRepository = entitlementRepository;
    this.now = now;
  }

  async confirmPayment(input: PaymentConfirmationInput): Promise<PaymentConfirmationResult> {
    assertValidPriceBookVersion(input.priceBookVersion);
    const now = this.now();
    try {
      return await runInTransaction(async (conn) => {
        const request = await this.changeRequestRepository.lockById(conn, input.requestId);
        if (!request) throw new SoftFailure<SoftCode>('REQUEST_NOT_FOUND');

        try {
          await execute(
            conn,
            `INSERT INTO entitlement_activation_idempotency (idempotency_key, request_id, family_id, applied_managed_device_limit, applied_at)
             VALUES (?, ?, ?, ?, ?)`,
            [input.idempotencyKey, input.requestId, request.familyId, input.targetDeviceLimit, now],
          );
        } catch (error) {
          if (!isDuplicateEntry(error)) throw error;
          const { rows } = await execute<{ applied_managed_device_limit: number }>(
            conn,
            `SELECT applied_managed_device_limit FROM entitlement_activation_idempotency WHERE idempotency_key = ?`,
            [input.idempotencyKey],
          );
          return { outcome: 'ALREADY_ACTIVATED' as const, appliedManagedDeviceLimit: rows[0]?.applied_managed_device_limit ?? null };
        }

        if (request.state !== 'PAYMENT_PENDING') throw new SoftFailure<SoftCode>('REQUEST_NOT_PAYMENT_PENDING');
        if (request.quote && request.quote.amountMinor !== input.amountMinor) throw new SoftFailure<SoftCode>('AMOUNT_MISMATCH');

        await this.entitlementRepository.lockForFamily(conn, request.familyId);
        await this.entitlementRepository.raiseLimit(conn, request.familyId, 'MANAGED_DEVICE_LIMIT', input.targetDeviceLimit, now);
        const approved = await this.changeRequestRepository.markApproved(conn, input.requestId, ['PAYMENT_PENDING'], null, false, now);
        if (!approved) throw new SoftFailure<SoftCode>('REQUEST_NOT_PAYMENT_PENDING');

        await insertPlatformAdminAuditEventRow(conn, {
          eventId: randomUUID(),
          eventType: 'ENTITLEMENT_INCREASED',
          actorAdminId: null,
          actorRole: null,
          targetRef: `family:${request.familyId}`,
          result: 'SUCCESS',
          occurredAt: now,
          correlationId: input.requestId,
          metadata: { requestId: input.requestId, paymentDriven: true, paymentTransactionId: input.paymentTransactionId, targetDeviceLimit: input.targetDeviceLimit },
        });
        await insertPlatformAdminAuditEventRow(conn, {
          eventId: randomUUID(),
          eventType: 'LIMIT_REQUEST_APPROVED',
          actorAdminId: null,
          actorRole: null,
          targetRef: `request:${input.requestId}`,
          result: 'SUCCESS',
          occurredAt: now,
          correlationId: input.requestId,
          metadata: { paymentDriven: true },
        });

        return { outcome: 'ACTIVATED' as const, appliedManagedDeviceLimit: input.targetDeviceLimit };
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: error.outcome as PaymentConfirmationOutcome, appliedManagedDeviceLimit: null };
      throw error;
    }
  }
}
