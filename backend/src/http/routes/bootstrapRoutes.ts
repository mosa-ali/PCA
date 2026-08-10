import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { EnrollmentError, type EnrollmentCoordinator } from '../../enrollment/EnrollmentCoordinator.js';
import { createRateLimiter } from '../rateLimit.js';
import { toBootstrapResultDto } from '../dto.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_TOKEN_LENGTH = 64;
const MAX_KEY_LENGTH = 128;
const VALID_PLATFORMS = new Set(['ANDROID', 'IOS']);

export interface BootstrapRoutesDeps {
  enrollmentCoordinator: EnrollmentCoordinator;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

/**
 * The external error vocabulary for a caller who does NOT already possess
 * a valid invitation token is deliberately narrower than the internal
 * EnrollmentErrorCode set: NOT_FOUND/EXPIRED/REVOKED/ALREADY_REDEEMED all
 * collapse into one generic "invitation_unavailable" response so this
 * endpoint can never become a token-guessing or existence-enumeration
 * oracle. The remaining codes (malformed token/keys, platform mismatch,
 * duplicate key) describe defects in the CALLER's own request shape --
 * information the caller already has by construction -- so those stay
 * distinguishable as ordinary 400s.
 */
const GENERIC_UNAVAILABLE_CODES = new Set(['NOT_FOUND', 'EXPIRED', 'REVOKED', 'ALREADY_REDEEMED']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Child/device enrollment bootstrap. Deliberately NOT behind
 * requireServiceSession -- authority here is only "possession of a valid,
 * single-use invitation token," never a parent's service session, account
 * id, role, or Admin PIN. Family membership comes solely from the
 * invitation record the coordinator looks up server-side; nothing the
 * caller supplies is trusted as family/authority context.
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
      const { rawInvitationToken, platform, signingPublicKey, encryptionPublicKey } = body;

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
        encryptionPublicKey.length > MAX_KEY_LENGTH
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      try {
        const result = await deps.enrollmentCoordinator.enrollDevice({
          rawInvitationToken,
          platform: platform as 'ANDROID' | 'IOS',
          signingPublicKey,
          encryptionPublicKey,
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
}
