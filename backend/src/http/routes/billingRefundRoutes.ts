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
 * PROVIDER-FIRST, NEVER A FALSE-SUCCESS REFUND ROW: `RefundService.issueRefund`
 * is called ONLY after `PaymentProvider.refund(...)` itself reports
 * CONFIRMED or PENDING. If the provider call throws, or reports FAILED,
 * this route audits the anomaly and rejects cleanly (502) WITHOUT ever
 * calling issueRefund -- billing_refunds.status only has
 * 'RECORDED'|'FAILED' and RefundRepository.insert hardcodes 'RECORDED'
 * (refund.ts, an accepted PCA-BILL-1 file this lane does not edit), so a
 * refund a provider actually rejected is never persisted as if it had
 * succeeded; it is simply never recorded at all. This is the documented,
 * deliberate trade-off in place of adding a FAILED-refund-recording method
 * to that accepted file.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAuthError } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import { requireBillingOperation, BillingAuthorizationError } from '../../billing/rbac.js';
import { RefundCurrencyMismatchError, RefundExceedsTransactionError, type RefundService } from '../../billing/refund.js';
import { PaymentRepository } from '../../billing/payment.js';
import { runInTransaction } from '../../db/pool.js';
import { isSupportedCurrency } from '../../billing/currency.js';
import { buildBillingAuditEvent } from '../../billing/audit.js';
import type { PlatformAdminAuditService } from '../../platformadmin/audit/PlatformAdminAuditService.js';
import type { PaymentProviderRegistry } from '../../billing/provider/providerRegistry.js';
import { createRateLimiter } from '../rateLimit.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_REASON_CODE_LENGTH = 32;
const MAX_REASON_NOTE_LENGTH = 255;
const DECIMAL_INTEGER_STRING = /^\d+$/;

export interface BillingRefundRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  providerRegistry: PaymentProviderRegistry;
  refundService: RefundService;
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
      const { paymentTransactionId, amountMinor, currencyCode, reasonCode, reasonNote, stepUpId } = body;
      if (typeof paymentTransactionId !== 'string' || paymentTransactionId.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof amountMinor !== 'string' || !DECIMAL_INTEGER_STRING.test(amountMinor)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof currencyCode !== 'string' || !isSupportedCurrency(currencyCode)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof reasonCode !== 'string' || reasonCode.length === 0 || reasonCode.length > MAX_REASON_CODE_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (reasonNote !== undefined && reasonNote !== null && (typeof reasonNote !== 'string' || reasonNote.length > MAX_REASON_NOTE_LENGTH)) {
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

      let provider;
      try {
        provider = deps.providerRegistry.resolve(transaction.provider);
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

      let providerRefundResult;
      try {
        providerRefundResult = await provider.refund(transaction.providerTransactionRef, amount, reasonCode);
      } catch {
        await deps.auditService.record(
          buildBillingAuditEvent({
            eventType: 'PAYMENT_ROLLED_BACK',
            actor,
            targetRef: `payment_transaction:${paymentTransactionId}`,
            result: 'FAILURE',
            occurredAt: new Date(),
            metadata: { reason: 'PROVIDER_REFUND_CALL_FAILED' },
          }),
        );
        return reply.code(502).send({ error: 'provider_refund_failed' });
      }

      if (providerRefundResult.status === 'FAILED') {
        await deps.auditService.record(
          buildBillingAuditEvent({
            eventType: 'PAYMENT_ROLLED_BACK',
            actor,
            targetRef: `payment_transaction:${paymentTransactionId}`,
            result: 'FAILURE',
            occurredAt: new Date(),
            metadata: { reason: 'PROVIDER_REFUND_REJECTED', providerRefundRef: providerRefundResult.providerRefundRef },
          }),
        );
        return reply.code(502).send({ error: 'provider_refund_failed' });
      }

      try {
        const refund = await deps.refundService.issueRefund(
          {
            paymentTransactionId,
            amountMinor: amount,
            currencyCode,
            reasonCode,
            reasonNote: (reasonNote as string | null | undefined) ?? null,
            stepUpSessionId: stepUpId,
            entitlementTreatment: 'NOT_APPLICABLE',
          },
          actor,
          roles,
        );
        return reply.code(201).send({
          refundId: refund.refundId,
          status: refund.status,
          providerRefundRef: providerRefundResult.providerRefundRef,
        });
      } catch (error) {
        if (error instanceof RefundExceedsTransactionError || error instanceof RefundCurrencyMismatchError) {
          return reply.code(409).send({ error: 'invalid_request' });
        }
        if (error instanceof BillingAuthorizationError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );
}
