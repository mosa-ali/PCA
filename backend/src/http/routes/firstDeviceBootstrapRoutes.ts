import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import {
  CSRF_HEADER_NAME,
  csrfCookieName,
  parseCookies,
  sessionCookieName,
} from '../../parentaccount/cookies.js';
import type { SensitiveParentStepUpOperation } from '../../parentaccount/mfa/ParentMfaRepository.js';
import type { FirstDeviceBootstrapService } from '../../familytrustset/FirstDeviceBootstrapService.js';
import { computeKeyFingerprint } from '../../pairing/fingerprint.js';
import { createRateLimiter } from '../rateLimit.js';

/**
 * Wave 6B: HTTP surface for the first-device trust-root bootstrap ceremony
 * (owner rulings D4/F4, WAVE 6B §13).
 *
 * Device-facing endpoints (/v1/first-device-bootstrap/*) are deliberately
 * NOT behind requireServiceSession: authority there is ONLY possession of a
 * valid enrollment-attempt recovery credential (attemptId + high-entropy
 * attemptRecoveryToken), exactly like /v1/enrollment/bootstrap/recover. The
 * family/device context comes solely from the server-side attempt record;
 * nothing the caller supplies is trusted as family context. Every device
 * route is rate-limited on its own bucket, and failures collapse into one
 * stable, enumeration-safe vocabulary per class:
 *   - 'ceremony_unavailable' -- credential/existence/state issues (404);
 *   - 'bootstrap_rejected'   -- verification/commit rejections (409).
 *
 * The parent endpoint follows the SAME session/CSRF/step-up conventions
 * removalDecisionRoutes.ts established (PCA-STEPUP-ORDER-1: every check not
 * dependent on the step-up token runs BEFORE the token is consumed) and
 * consumes the dedicated 'family.device.bootstrap.root' step-up operation.
 * The approval surface presents the device id, DSK key id and a DSK
 * fingerprint so the owner can compare them against the candidate device
 * (amendment M1).
 */

const MAX_BODY_BYTES = 8 * 1024;
/** H5: proof (16 KiB) + epoch-1 (256 KiB) + signatures + evidence, with framing headroom. */
const MAX_SUBMIT_BODY_BYTES = 320 * 1024;
const MIN_ATTEMPT_ID_LENGTH = 16;
const MAX_ATTEMPT_ID_LENGTH = 64;
const MIN_RECOVERY_TOKEN_LENGTH = 32;
const MAX_RECOVERY_TOKEN_LENGTH = 88;
const MAX_KEY_MATERIAL_LENGTH = 128;
const MAX_SIGNATURE_LENGTH = 200;
const MAX_CEREMONY_ID_LENGTH = 64;
const BOOTSTRAP_STEP_UP_OPERATION: SensitiveParentStepUpOperation = 'family.device.bootstrap.root';

export interface FirstDeviceBootstrapRoutesDeps {
  parentAccountService: ParentAccountService;
  bootstrapService: FirstDeviceBootstrapService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(sessionCookieName()) ?? null;
}

function csrfOk(request: FastifyRequest): boolean {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies.get(csrfCookieName());
  const headerToken = request.headers[CSRF_HEADER_NAME];
  if (typeof cookieToken !== 'string' || cookieToken.length === 0) return false;
  if (typeof headerToken !== 'string' || headerToken.length === 0) return false;
  return cookieToken === headerToken;
}

export function registerFirstDeviceBootstrapRoutes(app: FastifyInstance, deps: FirstDeviceBootstrapRoutesDeps): void {
  const { parentAccountService, bootstrapService } = deps;

  // ---------- device-facing ----------

  app.post(
    '/v1/first-device-bootstrap/challenge',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'first-device-bootstrap-challenge' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { attemptId, attemptRecoveryToken, dskKeyId, dskPublicKey } = body;
      if (
        !isBoundedString(attemptId, MIN_ATTEMPT_ID_LENGTH, MAX_ATTEMPT_ID_LENGTH) ||
        !isBoundedString(attemptRecoveryToken, MIN_RECOVERY_TOKEN_LENGTH, MAX_RECOVERY_TOKEN_LENGTH) ||
        !isBoundedString(dskKeyId, 1, MAX_KEY_MATERIAL_LENGTH) ||
        !isBoundedString(dskPublicKey, 1, MAX_KEY_MATERIAL_LENGTH)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const outcome = await bootstrapService.issueChallenge({ attemptId, attemptRecoveryToken, dskKeyId, dskPublicKey });
      if (outcome.status === 'UNAVAILABLE') return reply.code(404).send({ error: 'ceremony_unavailable' });
      return reply.code(200).send({
        status: outcome.status,
        ceremonyId: outcome.ceremonyId,
        challengeId: outcome.challengeId,
        nonce: outcome.nonce,
        expiresAt: outcome.expiresAt,
        familyId: outcome.familyId,
        deviceId: outcome.deviceId,
      });
    },
  );

  app.post(
    '/v1/first-device-bootstrap/submit',
    {
      bodyLimit: MAX_SUBMIT_BODY_BYTES,
      preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'first-device-bootstrap-submit' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { attemptId, attemptRecoveryToken, ceremonyId, proofBytes, proofSignature, epoch1Bytes, epoch1Signature } = body;
      const attestationEvidence = body.attestationEvidence;
      if (
        !isBoundedString(attemptId, MIN_ATTEMPT_ID_LENGTH, MAX_ATTEMPT_ID_LENGTH) ||
        !isBoundedString(attemptRecoveryToken, MIN_RECOVERY_TOKEN_LENGTH, MAX_RECOVERY_TOKEN_LENGTH) ||
        !isBoundedString(ceremonyId, 1, MAX_CEREMONY_ID_LENGTH) ||
        typeof proofBytes !== 'string' ||
        proofBytes.length === 0 ||
        !isBoundedString(proofSignature, 1, MAX_SIGNATURE_LENGTH) ||
        typeof epoch1Bytes !== 'string' ||
        epoch1Bytes.length === 0 ||
        !isBoundedString(epoch1Signature, 1, MAX_SIGNATURE_LENGTH) ||
        (attestationEvidence !== null && attestationEvidence !== undefined && typeof attestationEvidence !== 'string')
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const outcome = await bootstrapService.submit({
        attemptId,
        attemptRecoveryToken,
        ceremonyId,
        proofBytes,
        proofSignature,
        epoch1Bytes,
        epoch1Signature,
        attestationEvidence: attestationEvidence === undefined ? null : attestationEvidence,
      });
      if (outcome.status === 'UNAVAILABLE') return reply.code(404).send({ error: 'ceremony_unavailable' });
      if (outcome.status === 'REJECTED') return reply.code(409).send({ error: 'bootstrap_rejected' });
      return reply.code(200).send({ status: 'ACCEPTED' });
    },
  );

  app.post(
    '/v1/first-device-bootstrap/status',
    {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'first-device-bootstrap-status' })],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { attemptId, attemptRecoveryToken, ceremonyId } = body;
      if (
        !isBoundedString(attemptId, MIN_ATTEMPT_ID_LENGTH, MAX_ATTEMPT_ID_LENGTH) ||
        !isBoundedString(attemptRecoveryToken, MIN_RECOVERY_TOKEN_LENGTH, MAX_RECOVERY_TOKEN_LENGTH) ||
        !isBoundedString(ceremonyId, 1, MAX_CEREMONY_ID_LENGTH)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const outcome = await bootstrapService.readStatus({ attemptId, attemptRecoveryToken, ceremonyId });
      if (outcome.status === 'UNAVAILABLE') return reply.code(404).send({ error: 'ceremony_unavailable' });
      return reply.code(200).send({ status: outcome.status, outcome: outcome.outcome });
    },
  );

  // ---------- parent-facing ----------

  async function familySession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ accountId: string; familyId: string; rawSessionToken: string } | null> {
    const token = readSessionCookie(request);
    if (token === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    try {
      const session = await parentAccountService.readSession(token);
      if (!session.familyId) {
        await reply.code(403).send({ error: 'family_scope_required' });
        return null;
      }
      const { familyId } = request.params as { familyId?: string };
      if (!familyId || familyId !== session.familyId) {
        await reply.code(403).send({ error: 'family_scope_forbidden' });
        return null;
      }
      return { accountId: session.accountId, familyId: session.familyId, rawSessionToken: token };
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return null;
      }
      throw error;
    }
  }

  async function requireActiveAdministrator(
    session: { accountId: string; familyId: string },
    reply: FastifyReply,
  ): Promise<boolean> {
    try {
      if ((await parentAccountService.activeFamilyRole(session.accountId as never, session.familyId)) === 'ADMINISTRATOR') {
        return true;
      }
    } catch {
      // A failed role lookup must never authorize a trust-root ceremony.
    }
    await reply.code(403).send({ error: 'forbidden' });
    return false;
  }

  app.get(
    '/api/parent/families/:familyId/first-device-bootstrap/:ceremonyId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!(await requireActiveAdministrator(session, reply))) return;
      const { ceremonyId } = request.params as { ceremonyId: string };
      const ceremony = await bootstrapService.describeForApproval(session.familyId, ceremonyId);
      if (ceremony === null) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({
        ceremony: {
          ceremonyId: ceremony.ceremonyId,
          deviceId: ceremony.deviceId,
          dskKeyId: ceremony.dskKeyId,
          dskFingerprint: computeKeyFingerprint(ceremony.dskPublicKey),
          dskAlgorithm: ceremony.dskAlgorithm,
          status: ceremony.status,
          expiresAt: ceremony.expiresAt.toISOString(),
          createdAt: ceremony.createdAt.toISOString(),
          approvedAt: ceremony.approvedAt?.toISOString() ?? null,
          outcome: ceremony.outcome,
          consumedAt: ceremony.consumedAt?.toISOString() ?? null,
        },
      });
    },
  );

  app.post(
    '/api/parent/families/:familyId/first-device-bootstrap/approve',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      if (!(await requireActiveAdministrator(session, reply))) return;

      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { ceremonyId, stepUpToken } = body;
      if (!isBoundedString(ceremonyId, 1, MAX_CEREMONY_ID_LENGTH) || typeof stepUpToken !== 'string' || stepUpToken.length === 0) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      // PCA-STEPUP-ORDER-1: every rejection not dependent on the step-up token runs first.
      const ceremony = await bootstrapService.describeForApproval(session.familyId, ceremonyId);
      if (ceremony === null) return reply.code(404).send({ error: 'not_found' });
      if (!(await bootstrapService.checkApprovalEligibility(session.familyId, session.accountId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (!(await parentAccountService.consumeSensitiveStepUpForSession(
        session.rawSessionToken,
        session.familyId,
        BOOTSTRAP_STEP_UP_OPERATION,
        stepUpToken,
      ))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const outcome = await bootstrapService.approve({
        ceremonyId,
        familyId: session.familyId,
        accountId: session.accountId,
      });
      switch (outcome.status) {
        case 'APPROVED':
          return reply.code(200).send({
            status: 'APPROVED',
            ceremonyId: outcome.ceremony.ceremonyId,
            deviceId: outcome.ceremony.deviceId,
            dskKeyId: outcome.ceremony.dskKeyId,
            dskFingerprint: computeKeyFingerprint(outcome.ceremony.dskPublicKey),
          });
        case 'NOT_FOUND':
          return reply.code(404).send({ error: 'not_found' });
        case 'NOT_ELIGIBLE':
          return reply.code(403).send({ error: 'forbidden' });
        default:
          return reply.code(409).send({ error: 'ceremony_not_approvable' });
      }
    },
  );
}
