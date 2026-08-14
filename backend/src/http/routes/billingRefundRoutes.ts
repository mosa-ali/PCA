/**
 * PCA-BILL-2A -- admin-facing refund orchestration route. Requires a
 * Platform Administration session (FINANCE_ADMIN/APP_OWNER via
 * billing/rbac.ts's ISSUE_REFUND operation) AND an already-consumed
 * step-up grant scoped 'REFUND' (Agent41's
 * PlatformAdminAuthService.consumeStepUp) -- this route consumes the
 * step-up itself (the client obtains `stepUpId` from
 * POST /platform-admin/auth/step-up first, exactly like every other
 * sensitive Platform Administration operation).
 *
 * PCA-BILL-2A-R1 CORRECTION (refund split-state fix): this route used to
 * call `PaymentProvider.refund(...)` directly, then `RefundService.issueRefund`,
 * with NO durable local record of ANY kind until `issueRefund` itself
 * succeeded. If the provider call succeeded and `issueRefund` then threw,
 * money moved at the provider with zero local trace. All of that
 * orchestration now lives in `RefundOrchestrationService`
 * (billing/refundOrchestration/RefundOrchestrationService.ts), which
 * inserts a durable `billing_refund_operations` row FIRST (arbitrated
 * against the transaction's real remaining balance under a genuine DB row
 * lock -- see that module's header for the concurrency-race fix) and only
 * then calls the provider -- this route is now a thin HTTP adapter over
 * that service.
 *
 * IDEMPOTENCY KEY (required client input): the caller (the admin client)
 * MUST supply `idempotencyKey` in the request body. This is the anchor
 * that makes retrying this exact HTTP call after a partial failure safe:
 * the SAME key resumes the SAME operation from wherever it actually got to
 * (never re-calls the provider once it has confirmed, never re-arbitrates
 * the balance for an already-claimed operation) -- see
 * RefundOrchestrationService's own header for the full state machine.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAuthError } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import { requireBillingOperation, BillingAuthorizationError } from '../../billing/rbac.js';
import { PaymentRepository } from '../../billing/payment.js';
import { runInTransaction } from '../../db/pool.js';
import { isSupportedCurrency } from '../../billing/currency.js';
import { buildBillingAuditEvent } from '../../billing/audit.js';
import type { PlatformAdminAuditService } from '../../platformadmin/audit/PlatformAdminAuditService.js';
import type { PaymentProviderRegistry } from '../../billing/provider/providerRegistry.js';
import type { RefundOrchestrationService } from '../../billing/refundOrchestration/RefundOrchestrationService.js';
import { createRateLimiter } from '../rateLimit.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_REASON_CODE_LENGTH = 32;
const MAX_REASON_NOTE_LENGTH = 255;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const DECIMAL_INTEGER_STRING = /^\d+$/;

export interface BillingRefundRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  providerRegistry: PaymentProviderRegistry;
  refundOrchestrationService: RefundOrchestrationService;
  paymentRepository: PaymentRepository;
  auditService: PlatformAdminAuditService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function registerBillingRefundRoutes(app: FastifyInstance, deps: BillingRefundRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const refundAttemptLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'billing-refund' });

  app.post(
    '/billing/admin/refund',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [refundAttemptLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      try {
        requireBillingOperation(roles, 'ISSUE_REFUND');
      } catch (error) {
        if (error instanceof BillingAuthorizationError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }

      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { paymentTransactionId, amountMinor, currencyCode, reasonCode, reasonNote, stepUpId, idempotencyKey } = body;
      if (typeof paymentTransactionId !== 'string' || paymentTransactionId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof amountMinor !== 'string' || !DECIMAL_INTEGER_STRING.test(amountMinor)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof currencyCode !== 'string' || !isSupportedCurrency(currencyCode)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof reasonCode !== 'string' || reasonCode.length === 0 || reasonCode.length > MAX_REASON_CODE_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (reasonNote !== undefined && reasonNote !== null && (typeof reasonNote !== 'string' || reasonNote.length > MAX_REASON_NOTE_LENGTH)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (typeof stepUpId !== 'string' || stepUpId.length === 0) return reply.code(403).send({ error: 'forbidden' });

      const adminId = request.platformAdminId as string;
      const sessionId = request.platformAdminSessionId as string;

      try {
        await deps.platformAdminAuthService.consumeStepUp(stepUpId, adminId, sessionId, 'REFUND');
      } catch (error) {
        if (error instanceof PlatformAdminAuthError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }

      const transaction = await runInTransaction((conn) => deps.paymentRepository.findTransactionById(conn, paymentTransactionId));
      if (!transaction) return reply.code(404).send({ error: 'not_found' });

      try {
        deps.providerRegistry.resolve(transaction.provider);
      } catch {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      let amount: bigint;
      try {
        amount = BigInt(amountMinor);
      } catch {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (amount <= 0n) return reply.code(400).send({ error: 'invalid_request' });

      const actor = { adminId, role: roles[0] ?? null };

      const result = await deps.refundOrchestrationService.initiateRefund(
        {
          paymentTransactionId,
          amountMinor: amount,
          currencyCode,
          reasonCode,
          reasonNote: (reasonNote as string | null | undefined) ?? null,
          stepUpSessionId: stepUpId,
          idempotencyKey,
          provider: transaction.provider,
        },
        actor,
        roles,
      );

      switch (result.outcome) {
        case 'FINALIZED':
          return reply.code(201).send({
            refundId: result.refund.refundId,
            status: result.refund.status,
            providerRefundRef: result.operation.providerRefundRef,
            refundOperationId: result.operation.refundOperationId,
          });
        case 'PENDING_FINALIZATION':
          // The provider already confirmed this refund -- money has
          // genuinely moved -- but the local billing_refunds row could not
          // be finalized yet. This is durably recorded (never lost) and
          // recoverable by retrying this exact call with the same
          // idempotencyKey. Surfaced as 202 (accepted, not yet complete),
          // never as a plain failure -- a client must not interpret this as
          // "nothing happened" and re-attempt with a NEW idempotencyKey.
          await deps.auditService.record(
            buildBillingAuditEvent({
              eventType: 'PAYMENT_ROLLED_BACK',
              actor,
              targetRef: `payment_transaction:${paymentTransactionId}`,
              result: 'FAILURE',
              occurredAt: new Date(),
              metadata: { reason: 'REFUND_FINALIZATION_PENDING', refundOperationId: result.operation.refundOperationId, providerRefundRef: result.operation.providerRefundRef },
            }),
          );
          return reply.code(202).send({
            error: 'refund_pending_finalization',
            refundOperationId: result.operation.refundOperationId,
            providerRefundRef: result.operation.providerRefundRef,
          });
        case 'PROVIDER_REFUND_FAILED':
          await deps.auditService.record(
            buildBillingAuditEvent({
              eventType: 'PAYMENT_ROLLED_BACK',
              actor,
              targetRef: `payment_transaction:${paymentTransactionId}`,
              result: 'FAILURE',
              occurredAt: new Date(),
              metadata: { reason: 'PROVIDER_REFUND_REJECTED', refundOperationId: result.operation.refundOperationId },
            }),
          );
          return reply.code(502).send({ error: 'provider_refund_failed' });
        case 'PROVIDER_CALL_ERROR':
          await deps.auditService.record(
            buildBillingAuditEvent({
              eventType: 'PAYMENT_ROLLED_BACK',
              actor,
              targetRef: `payment_transaction:${paymentTransactionId}`,
              result: 'FAILURE',
              occurredAt: new Date(),
              metadata: { reason: 'PROVIDER_REFUND_CALL_FAILED', refundOperationId: result.operation.refundOperationId },
            }),
          );
          return reply.code(502).send({ error: 'provider_refund_failed', refundOperationId: result.operation.refundOperationId });
        case 'TRANSACTION_NOT_FOUND':
          return reply.code(404).send({ error: 'not_found' });
        case 'CURRENCY_MISMATCH':
        case 'EXCEEDS_BALANCE':
          return reply.code(409).send({ error: 'invalid_request' });
        case 'UNKNOWN_PROVIDER':
          return reply.code(400).send({ error: 'invalid_request' });
      }
    },
  );
}
