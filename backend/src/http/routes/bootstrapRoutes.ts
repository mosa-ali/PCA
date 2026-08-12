import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { EnrollmentError, type EnrollmentCoordinator } from '../../enrollment/EnrollmentCoordinator.js';
import { createRateLimiter } from '../rateLimit.js';
import { toBootstrapResultDto } from '../dto.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_TOKEN_LENGTH = 64;
const MAX_KEY_LENGTH = 128;
const MIN_ATTEMPT_ID_LENGTH = 16;
const MAX_ATTEMPT_ID_LENGTH = 64;
const MIN_RECOVERY_TOKEN_LENGTH = 32;
const MAX_RECOVERY_TOKEN_LENGTH = 88;
const VALID_PLATFORMS = new Set(['ANDROID', 'IOS']);

export interface BootstrapRoutesDeps {
  enrollmentCoordinator: EnrollmentCoordinator;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

/**
 * The external error vocabulary for a caller who does NOT already possess
 * a valid invitation token (or, for recovery, a valid attemptRecoveryToken)
 * is deliberately narrower than the internal EnrollmentErrorCode set:
 * NOT_FOUND/EXPIRED/REVOKED/ALREADY_REDEEMED/ATTEMPT_CONFLICT all collapse
 * into one generic "invitation_unavailable" response so this endpoint can
 * never become a token-guessing, attempt-guessing, or existence-
 * enumeration oracle. The remaining codes (malformed token/keys/attempt
 * id/recovery token, platform mismatch, duplicate key) describe defects in
 * the CALLER's own request shape -- information the caller already has by
 * construction -- so those stay distinguishable as ordinary 400s.
 */
const GENERIC_UNAVAILABLE_CODES = new Set(['NOT_FOUND', 'EXPIRED', 'REVOKED', 'ALREADY_REDEEMED', 'ATTEMPT_CONFLICT']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

/**
 * Child/device enrollment bootstrap. Deliberately NOT behind
 * requireServiceSession -- authority here is only "possession of a valid,
 * single-use invitation token," never a parent's service session, account
 * id, role, or Admin PIN. Family membership comes solely from the
 * invitation record the coordinator looks up server-side; nothing the
 * caller supplies (including bootstrapAttemptId/attemptRecoveryToken) is
 * ever trusted as family/authority context -- see EnrollmentCoordinator's
 * class doc comment.
 */
export function registerBootstrapRoutes(app: FastifyInstance, deps: BootstrapRoutesDeps): void {
  app.post(
    '/v1/enrollment/bootstrap',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'bootstrap' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { rawInvitationToken, platform, signingPublicKey, encryptionPublicKey, bootstrapAttemptId, attemptRecoveryToken } = body;

      if (
        typeof rawInvitationToken !== 'string' ||
        rawInvitationToken.length === 0 ||
        rawInvitationToken.length > MAX_TOKEN_LENGTH ||
        typeof platform !== 'string' ||
        !VALID_PLATFORMS.has(platform) ||
        typeof signingPublicKey !== 'string' ||
        signingPublicKey.length === 0 ||
        signingPublicKey.length > MAX_KEY_LENGTH ||
        typeof encryptionPublicKey !== 'string' ||
        encryptionPublicKey.length === 0 ||
        encryptionPublicKey.length > MAX_KEY_LENGTH ||
        !isBoundedString(bootstrapAttemptId, MIN_ATTEMPT_ID_LENGTH, MAX_ATTEMPT_ID_LENGTH) ||
        !isBoundedString(attemptRecoveryToken, MIN_RECOVERY_TOKEN_LENGTH, MAX_RECOVERY_TOKEN_LENGTH)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const result = await deps.enrollmentCoordinator.enrollDevice({
          rawInvitationToken,
          platform: platform as 'ANDROID' | 'IOS',
          signingPublicKey,
          encryptionPublicKey,
          attemptId: bootstrapAttemptId,
          attemptRecoveryToken,
        });
        return reply.code(201).send(toBootstrapResultDto(result));
      } catch (error) {
        if (error instanceof EnrollmentError) {
          if (GENERIC_UNAVAILABLE_CODES.has(error.code)) {
            return reply.code(404).send({ error: 'invitation_unavailable' });
          }
          return reply.code(400).send({ error: 'invalid_request' });
        }
        throw error;
      }
    },
  );

  /**
   * Response-loss recovery. Authority here is possession of
   * attemptRecoveryToken -- a high-entropy secret the client generated and
   * durably persisted BEFORE the original bootstrap request, distinct from
   * the (never-persisted) raw invitation token. bootstrapAttemptId alone is
   * NOT authority (it is not secret): see EnrollmentCoordinator.recoverAttempt.
   *
   * Rate-limited on its own bucket, separate from bootstrap, so recovery
   * polling by a legitimately-recovering client cannot be starved by (or
   * itself starve) fresh bootstrap attempts.
   */
  app.post(
    '/v1/enrollment/bootstrap/recover',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'bootstrap-recover' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { bootstrapAttemptId, attemptRecoveryToken } = body;

      if (
        !isBoundedString(bootstrapAttemptId, MIN_ATTEMPT_ID_LENGTH, MAX_ATTEMPT_ID_LENGTH) ||
        !isBoundedString(attemptRecoveryToken, MIN_RECOVERY_TOKEN_LENGTH, MAX_RECOVERY_TOKEN_LENGTH)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const result = await deps.enrollmentCoordinator.recoverAttempt({ attemptId: bootstrapAttemptId, attemptRecoveryToken });
        return reply.code(200).send(toBootstrapResultDto(result));
      } catch (error) {
        if (error instanceof EnrollmentError) {
          // recoverAttempt only ever throws INVALID_ATTEMPT_ID/INVALID_RECOVERY_TOKEN
          // (malformed request shape) or NOT_FOUND (unknown attempt id, or
          // wrong recovery token -- identical response, no oracle).
          if (error.code === 'NOT_FOUND') return reply.code(404).send({ error: 'invitation_unavailable' });
          return reply.code(400).send({ error: 'invalid_request' });
        }
        throw error;
      }
    },
  );
}
