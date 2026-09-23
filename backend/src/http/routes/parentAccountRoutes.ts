/**
 * PCA-AUTH-SESSION-1 (PCA-DEC-026, FAMILY_SERVICE_SESSION_V1) -- browser-
 * reachable parent/family account identity + session issuance. Every route
 * here is new (none existed before this lane). Session transport is an
 * HttpOnly, Secure-in-production, SameSite=Strict cookie
 * (`pca_family_session`) plus a non-HttpOnly double-submit CSRF companion
 * cookie (`pca_family_csrf`) state-changing routes require echoed in the
 * `X-PCA-CSRF-Token` header -- cookie presence alone never authorizes a
 * mutation (see ../../parentaccount/cookies.ts).
 *
 * SESSION BACKING STORE: the raw token this module puts in the
 * `pca_family_session` cookie is the SAME opaque token format
 * backend/src/auth/AuthService.issueSession already produces and
 * backend/src/auth/fastifyAuthPlugin.ts's Bearer-header
 * `requireServiceSession` already validates -- this lane adds a cookie
 * TRANSPORT for that existing token, it does not invent a second token
 * format. That is what makes this lane's E2E proof
 * (register -> verify -> family-commercial GET -> Owner mutation) reach the
 * REAL, unmodified familyCommercialRoutes.ts/billingCheckoutRoutes.ts today
 * via `Authorization: Bearer <same token>` even before the Coordinator
 * additively wires cookie support into those routes' own preHandlers (see
 * this lane's final report).
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { GenesisChallengeError } from '../../parentaccount/GenesisChallengeService.js';
import { createKeyedRateLimiter } from '../../parentaccount/rateLimiter.js';
import { hashParentEmail } from '../../parentaccount/emailHash.js';
import {
  CSRF_HEADER_NAME,
  csrfCookieName,
  parseCookies,
  serializeCookie,
  serializeExpiredCookie,
  dailyLoginGrantCookieName,
  sessionCookieName,
} from '../../parentaccount/cookies.js';
import { isProductionSensitiveRuntime } from '../../runtime/environment.js';
import {
  LOGIN_EMAIL_RATE_LIMIT,
  LOGIN_IP_RATE_LIMIT,
  LOGIN_STEP_UP_EMAIL_RATE_LIMIT,
  LOGIN_STEP_UP_IP_RATE_LIMIT,
  REGISTER_EMAIL_RATE_LIMIT,
  REGISTER_IP_RATE_LIMIT,
  REQUEST_PASSWORD_RESET_EMAIL_RATE_LIMIT,
  REQUEST_PASSWORD_RESET_IP_RATE_LIMIT,
  RESET_PASSWORD_EMAIL_RATE_LIMIT,
  RESET_PASSWORD_IP_RATE_LIMIT,
  VERIFY_EMAIL_RATE_LIMIT,
  GENESIS_STEP_UP_EMAIL_RATE_LIMIT,
  GENESIS_STEP_UP_IP_RATE_LIMIT,
  VERIFY_IP_RATE_LIMIT,
  DAILY_LOGIN_GRANT_TTL_MS,
} from '../../parentaccount/policy.js';
import { deriveFreeAccessStatus } from '../../parentaccount/freeaccess/deriveFreeAccessStatus.js';
import type { FreeAccessAccountRepository } from '../../parentaccount/freeaccess/FreeAccessAccountRepository.js';
import type { ParentPreferenceRepository, ParentPreferencesPatch, ParentLanguage } from '../../parentaccount/ParentPreferenceRepository.js';
import { SafeZoneError, type NewSafeZone, type SafeZonePatch, type SafeZoneRepository } from '../../location/SafeZoneRepository.js';
import type { SafeZonePolicyAuthorizer } from '../../location/SafeZonePolicyAuthorization.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { ParentSignupProfile } from '../../parentaccount/types.js';
import { isGenesisPlatform } from '../../parentaccount/genesisProtocol.js';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_SAFE_ZONE_BODY_BYTES = 96 * 1024;
const CSRF_TOKEN_BYTES = 32;
/**
 * SECURITY (actor-identity binding -- see `authorizeSafeZoneRequest` below):
 * this header is legacy/defense-in-depth ONLY. It is never, by itself, a
 * source of actor identity -- a client-supplied header has no
 * cryptographic or session binding to the actual caller, so an
 * authenticated parent-web session could otherwise claim ANY deviceId
 * string (e.g. another family member's, or the Owner's) and have it
 * trusted verbatim. The real actor identity is derived exclusively from a
 * verified `DeviceSessionService` session token (`Authorization: Bearer
 * <token>`, minted only after DeviceAuthService challenge-response proof
 * of possession -- see DeviceSessionService.ts). If this header is present
 * at all it is cross-checked against that verified identity and the
 * request is REJECTED on any mismatch; it is never trusted over the
 * session-derived value.
 */
const ACTOR_DEVICE_HEADER = 'x-pca-actor-device-id';

export interface ParentAccountRoutesDeps {
  parentAccountService: ParentAccountService;
  /**
   * Whether this deployment can actually COMPLETE a genesis ceremony.
   *
   * The production composition wires a rejecting device-signature verifier until
   * the external human cryptographic review passes (see main.ts), so every
   * completion is refused at signature verification. That refusal is the
   * CORRECT fail-closed behaviour -- but the route reported it as 401, so the
   * client told the parent their SESSION had expired. It had not: nothing was
   * wrong with the session, and signing in again cannot fix it. A dedicated 503
   * (`genesis_unavailable`) says the true thing, and lets the client fail BEFORE
   * generating a device key it has no way to use.
   *
   * Optional for the same additive-dependency reason as `deviceSessionService`,
   * and declared so that the Safe Zone routes' precedent is followed: an
   * unavailable capability fails closed with a SEMANTIC 503 rather than a crash
   * or a misleading 4xx. `undefined` is treated as AVAILABLE, because a composer
   * that has not declared the capability must not be silently told genesis is
   * impossible.
   */
  genesisCryptographyAvailable?: boolean;
  parentPreferenceRepository?: ParentPreferenceRepository;
  safeZoneRepository?: SafeZoneRepository;
  safeZonePolicyAuthorizer?: SafeZonePolicyAuthorizer;
  /**
   * SECURITY (actor-identity binding): backs `authorizeSafeZoneRequest`'s
   * derivation of `actorDeviceId` from a verified, session-bound identity
   * instead of the raw, spoofable `x-pca-actor-device-id` header -- see
   * that header constant's own doc comment above and
   * `authorizeSafeZoneRequest`'s doc comment below. Optional (rather than
   * required) for the same reason `freeAccessAccountRepository` is: an
   * additive dependency the Coordinator wires in via buildServer.ts/
   * main.ts without touching this lane's call signature. Until wired, the
   * Safe Zone routes fail closed with 503 (`family_authority_unavailable`)
   * -- never a crash, and never a silent fall-back to trusting the raw
   * header.
   */
  deviceSessionService?: DeviceSessionService;
  /**
   * FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61): backs the new
   * GET /api/parent/free-access-status route below. A distinct,
   * narrowly-scoped read port -- see FreeAccessAccountRepository.ts's own
   * doc comment for why this is a second port against `parent_accounts`
   * rather than an extension of ParentAccountRepository. Optional (rather
   * than required) so this additive change never breaks
   * buildServer.ts's EXISTING call site (a Coordinator-owned file this
   * lane does not edit) until the Coordinator wires the new dependency in
   * -- see this lane's final report's COORDINATOR_BINDING_REQUIRED item.
   * Until wired, the new route fails closed with 503, never a crash or a
   * silently-wrong 200.
   */
  freeAccessAccountRepository?: FreeAccessAccountRepository;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
}

/** 12h, matching AuthService's own DEFAULT_SESSION_TTL_MS -- kept as a local constant rather than importing auth/policy.ts's internal default, since this module only needs the wall-clock duration to size the cookie's Max-Age, never the TTL enforcement itself (AuthService still owns that). */
const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const DAILY_LOGIN_GRANT_COOKIE_MAX_AGE_SECONDS = Math.floor(DAILY_LOGIN_GRANT_TTL_MS / 1000);

function setSessionCookies(reply: FastifyReply, rawSessionToken: string, rawDailyLoginGrantToken?: string): string {
  const secure = isProductionSensitiveRuntime();
  const csrfToken = generateCsrfToken();
  const cookies = [
    serializeCookie(sessionCookieName(), rawSessionToken, { httpOnly: true, secure, maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS }),
    serializeCookie(csrfCookieName(), csrfToken, { httpOnly: false, secure, maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS }),
  ];
  if (rawDailyLoginGrantToken) {
    cookies.push(serializeCookie(dailyLoginGrantCookieName(), rawDailyLoginGrantToken, { httpOnly: true, secure, maxAgeSeconds: DAILY_LOGIN_GRANT_COOKIE_MAX_AGE_SECONDS }));
  }
  reply.header('Set-Cookie', cookies);
  return csrfToken;
}

function clearSessionCookies(reply: FastifyReply): void {
  const secure = isProductionSensitiveRuntime();
  reply.header('Set-Cookie', [
    serializeExpiredCookie(sessionCookieName(), { httpOnly: true, secure }),
    serializeExpiredCookie(csrfCookieName(), { httpOnly: false, secure }),
    serializeExpiredCookie(dailyLoginGrantCookieName(), { httpOnly: true, secure }),
  ]);
}

function readSessionCookie(request: FastifyRequest): string | null {
  const cookies = parseCookies(request.headers.cookie);
  return cookies.get(sessionCookieName()) ?? null;
}

function readDailyLoginGrantCookie(request: FastifyRequest): string | null {
  const cookies = parseCookies(request.headers.cookie);
  return cookies.get(dailyLoginGrantCookieName()) ?? null;
}

/** Double-submit CSRF check: the `pca_family_csrf` cookie value must exactly match the `X-PCA-CSRF-Token` header. Cookie presence alone (without the header, or with a mismatched header) never passes -- an attacker's cross-origin form/fetch can trigger the cookie to be sent automatically but cannot read it to also set the matching header, and SameSite=Strict additionally blocks the cookie from even being attached on a cross-site navigation/request. */
function csrfOk(request: FastifyRequest): boolean {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies.get(csrfCookieName());
  const headerToken = request.headers[CSRF_HEADER_NAME];
  if (typeof cookieToken !== 'string' || cookieToken.length === 0) return false;
  if (typeof headerToken !== 'string' || headerToken.length === 0) return false;
  return cookieToken === headerToken;
}

export function registerParentAccountRoutes(app: FastifyInstance, deps: ParentAccountRoutesDeps): void {
  const { parentAccountService } = deps;
  const rateLimiter = createKeyedRateLimiter();

  function rateLimited(bucket: string, ipPolicy: { windowMs: number; max: number }, emailPolicy: { windowMs: number; max: number }, ip: string, email: string): boolean {
    const ipOk = rateLimiter.consume(`${bucket}:ip`, ip, ipPolicy.windowMs, ipPolicy.max);
    const emailOk = rateLimiter.consume(`${bucket}:email`, hashParentEmail(email).toString('hex'), emailPolicy.windowMs, emailPolicy.max);
    return ipOk && emailOk;
  }

  app.post('/api/parent/register', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isPlainObject(request.body)) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const { email, password, passwordConfirmation, accountType, estimatedChildCount } = request.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string' || typeof passwordConfirmation !== 'string') {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    if (!rateLimited('register', REGISTER_IP_RATE_LIMIT, REGISTER_EMAIL_RATE_LIMIT, request.ip, email)) {
      await reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    try {
      let profile: ParentSignupProfile | undefined;
      if (accountType !== undefined || estimatedChildCount !== undefined) {
        const validAccountType = accountType === 'PARENT_GUARDIAN' || accountType === 'OTHER';
        const validCount =
          estimatedChildCount === undefined || estimatedChildCount === null ||
          (typeof estimatedChildCount === 'number' && Number.isInteger(estimatedChildCount) && estimatedChildCount >= 0 && estimatedChildCount <= 50);
        if (!validAccountType || !validCount) {
          await reply.code(400).send({ error: 'invalid_request' });
          return;
        }
        profile = {
          accountType,
          estimatedChildCount: estimatedChildCount === undefined ? null : estimatedChildCount,
        };
      }
      const result = await parentAccountService.register(email, password, passwordConfirmation, profile ?? undefined);
      await reply.code(202).send(result);
    } catch (error) {
      if (error instanceof ParentAccountError && error.code === 'INVALID_INPUT') {
        await reply.code(400).send({ error: 'invalid_request' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/parent/verify-email', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isPlainObject(request.body)) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const { email, code } = request.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof code !== 'string') {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    if (!rateLimited('verify-email', VERIFY_IP_RATE_LIMIT, VERIFY_EMAIL_RATE_LIMIT, request.ip, email)) {
      await reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    try {
      const result = await parentAccountService.verifyEmail(email, code);
      setSessionCookies(reply, result.rawSessionToken);
      await reply.code(200).send({ accountId: result.accountId, familyId: result.familyId, role: result.role, sessionEstablished: true });
    } catch (error) {
      if (error instanceof ParentAccountError) {
        const status = error.code === 'INVALID_INPUT' ? 400 : 401;
        await reply.code(status).send({ error: error.code === 'INVALID_INPUT' ? 'invalid_request' : 'invalid_code' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/parent/request-password-reset', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isPlainObject(request.body)) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const { email } = request.body as Record<string, unknown>;
    if (typeof email !== 'string') {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    if (!rateLimited('request-password-reset', REQUEST_PASSWORD_RESET_IP_RATE_LIMIT, REQUEST_PASSWORD_RESET_EMAIL_RATE_LIMIT, request.ip, email)) {
      await reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    try {
      const result = await parentAccountService.requestPasswordReset(email);
      await reply.code(202).send(result);
    } catch (error) {
      if (error instanceof ParentAccountError && error.code === 'INVALID_INPUT') {
        await reply.code(400).send({ error: 'invalid_request' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/parent/reset-password', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isPlainObject(request.body)) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const { email, code, newPassword, newPasswordConfirmation } = request.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof code !== 'string' || typeof newPassword !== 'string' || typeof newPasswordConfirmation !== 'string') {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    if (!rateLimited('reset-password', RESET_PASSWORD_IP_RATE_LIMIT, RESET_PASSWORD_EMAIL_RATE_LIMIT, request.ip, email)) {
      await reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    try {
      const result = await parentAccountService.resetPassword(email, code, newPassword, newPasswordConfirmation);
      await reply.code(200).send(result);
    } catch (error) {
      if (error instanceof ParentAccountError) {
        const status = error.code === 'INVALID_INPUT' ? 400 : 401;
        await reply.code(status).send({ error: error.code === 'INVALID_INPUT' ? 'invalid_request' : 'invalid_code' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/parent/login', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isPlainObject(request.body)) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const { email, password } = request.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    if (!rateLimited('login', LOGIN_IP_RATE_LIMIT, LOGIN_EMAIL_RATE_LIMIT, request.ip, email)) {
      await reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    try {
      const result = await parentAccountService.login(email, password, readDailyLoginGrantCookie(request) ?? undefined);
      if (result.status === 'STEP_UP_REQUIRED') {
        await reply.code(200).send({ sessionEstablished: false, stepUpRequired: true });
        return;
      }
      setSessionCookies(reply, result.rawSessionToken);
      await reply.code(200).send({ accountId: result.accountId, familyId: result.familyId, role: result.role, sessionEstablished: true });
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'invalid_credentials' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/parent/login/step-up', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isPlainObject(request.body)) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const { email, code } = request.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof code !== 'string') {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    if (!rateLimited('login-step-up', LOGIN_STEP_UP_IP_RATE_LIMIT, LOGIN_STEP_UP_EMAIL_RATE_LIMIT, request.ip, email)) {
      await reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    try {
      const result = await parentAccountService.completeLoginStepUp(email, code);
      setSessionCookies(reply, result.rawSessionToken, result.rawDailyLoginGrantToken);
      await reply.code(200).send({ accountId: result.accountId, familyId: result.familyId, role: result.role, sessionEstablished: true });
    } catch (error) {
      if (error instanceof ParentAccountError) {
        const status = error.code === 'INVALID_INPUT' ? 400 : 401;
        await reply.code(status).send({ error: error.code === 'INVALID_INPUT' ? 'invalid_request' : 'invalid_code' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/parent/genesis/step-up', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    // Same fail-closed gate as /challenge and /complete, checked BEFORE the
    // rate limiter and before any service call: a deployment that cannot
    // complete a ceremony must not ask the parent for their password and a
    // one-time code, burn the code, and only then report the impossibility.
    if (deps.genesisCryptographyAvailable === false) return reply.code(503).send({ error: 'genesis_unavailable' });
    if (!isPlainObject(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const { email, password } = request.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    if (!rateLimited('genesis-step-up', GENESIS_STEP_UP_IP_RATE_LIMIT, GENESIS_STEP_UP_EMAIL_RATE_LIMIT, request.ip, email)) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    try {
      await parentAccountService.requestGenesisStepUp(token, email, password);
      return reply.code(202).send({ stepUpRequired: true });
    } catch (error) {
      if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
      throw error;
    }
  });

  app.post('/api/parent/genesis/step-up/complete', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    // Same fail-closed gate as the other genesis routes, checked BEFORE the
    // rate limiter and before any service call -- see /genesis/step-up above.
    if (deps.genesisCryptographyAvailable === false) return reply.code(503).send({ error: 'genesis_unavailable' });
    if (!isPlainObject(request.body) || typeof (request.body as Record<string, unknown>).code !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    if (!rateLimiter.consume('genesis-step-up-complete:ip', request.ip, GENESIS_STEP_UP_IP_RATE_LIMIT.windowMs, GENESIS_STEP_UP_IP_RATE_LIMIT.max)) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    try {
      await parentAccountService.completeGenesisStepUp(token, (request.body as Record<string, unknown>).code as string);
      return reply.code(200).send({ stepUpCompleted: true });
    } catch (error) {
      if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
      throw error;
    }
  });

  app.get('/api/parent/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    try {
      const result = await parentAccountService.readSession(token);
      await reply.code(200).send(result);
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post('/api/parent/genesis/challenge', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    if (deps.genesisCryptographyAvailable === false) return reply.code(503).send({ error: 'genesis_unavailable' });
    if (!deps.parentAccountService || !isPlainObject(request.body)) return reply.code(503).send({ error: 'not_configured' });
    const body = request.body as Record<string, unknown>;
    if (typeof body.publicKey !== 'string' || !isGenesisPlatform(body.platform)) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const challenge = await deps.parentAccountService.beginGenesisChallenge(token, { publicKey: body.publicKey, platform: body.platform });
      return reply.code(201).send({
        protocolVersion: challenge.protocolVersion,
        operation: challenge.operation,
        accountId: challenge.accountId,
        serviceAccountId: challenge.serviceAccountId,
        familyId: challenge.familyId,
        deviceId: challenge.candidateDeviceId,
        keyId: challenge.candidateKeyId,
        publicKey: challenge.candidatePublicKey,
        platform: challenge.candidatePlatform,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        createdAt: challenge.createdAt.toISOString(),
        expiresAt: challenge.expiresAt.toISOString(),
      });
    } catch (error) {
      // Explicit on the CODE rather than the class: today beginGenesisChallenge
      // only throws UNAUTHORIZED, but a class-level mapping would silently
      // answer a future INVALID_INPUT as a session problem.
      if (error instanceof ParentAccountError) {
        if (error.code === 'UNAUTHORIZED') return reply.code(401).send({ error: 'unauthorized' });
        if (error.code === 'INVALID_INPUT') return reply.code(400).send({ error: 'invalid_request' });
      }
      // GenesisChallengeService.begin validates the P-256 point strictly and
      // reports a client-supplied key that is not a valid point as
      // INVALID_PUBLIC_KEY. The route's shape check only sees a string, so
      // this class reaches the catch for any malformed key: a 400 about the
      // request, not a server fault.
      if (error instanceof GenesisChallengeError && error.code === 'INVALID_PUBLIC_KEY') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      throw error;
    }
  });

  app.post('/api/parent/genesis/complete', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    // Checked BEFORE the body is parsed or any work is done: a deployment that
    // cannot complete a ceremony should say so immediately rather than accepting
    // a proof it is structurally unable to verify.
    if (deps.genesisCryptographyAvailable === false) return reply.code(503).send({ error: 'genesis_unavailable' });
    if (!isPlainObject(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const body = request.body as Record<string, unknown>;
    const issuedAt = typeof body.issuedAt === 'string' ? new Date(body.issuedAt) : null;
    const expiresAt = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null;
    if (
      typeof body.challengeId !== 'string' ||
      typeof body.proofSignature !== 'string' ||
      typeof body.anchorSignature !== 'string' ||
      typeof body.attestationSignature !== 'string' ||
      typeof body.trustSetEpoch !== 'number' ||
      typeof body.keyEpoch !== 'number' ||
      issuedAt === null ||
      expiresAt === null
    ) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const result = await deps.parentAccountService.completeGenesis(token, {
        challengeId: body.challengeId,
        proofSignature: body.proofSignature,
        anchorSignature: body.anchorSignature,
        attestationSignature: body.attestationSignature,
        trustSetEpoch: body.trustSetEpoch,
        keyEpoch: body.keyEpoch,
        issuedAt,
        expiresAt,
      });
      return reply.code(200).send({ ...result, genesisCompleted: true });
    } catch (error) {
      // 401 is reserved for a genuinely missing or invalid SESSION or step-up
      // authorization, which ParentAccountService.completeGenesis reports as
      // ParentAccountError('UNAUTHORIZED'). That is exactly what the client's
      // SESSION_EXPIRED handling is for; collapsing it into the proof status
      // below would hide a real re-authentication need.
      if (error instanceof ParentAccountError) {
        if (error.code === 'UNAUTHORIZED') return reply.code(401).send({ error: 'unauthorized' });
        if (error.code === 'INVALID_INPUT') return reply.code(400).send({ error: 'invalid_request' });
      }
      // A REJECTED PROOF (GenesisChallengeError: NOT_FOUND / EXPIRED /
      // ALREADY_CONSUMED / INVALID_SIGNATURE, thrown by GenesisChallengeService
      // and ParentGenesisService) is a 400 about the proof, with ONE body for
      // all four codes: the challenge is session-bound, but the endpoint must
      // not hand the caller a NOT_FOUND/CONSUMED oracle for free.
      // Answering it with 401 was the defect: it made the client report an
      // expired session -- false, and it sent the parent to sign in again for a
      // problem that signing in cannot fix.
      if (error instanceof GenesisChallengeError) return reply.code(400).send({ error: 'invalid_genesis_proof' });
      // Anything else is a server-side fault. Rethrow and let the shared error
      // boundary answer, rather than inventing a client-facing classification
      // here that would misattribute an infrastructure failure.
      throw error;
    }
  });

  app.post('/api/parent/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token !== null && !csrfOk(request)) {
      await reply.code(403).send({ error: 'csrf_mismatch' });
      return;
    }
    if (token !== null) {
      await parentAccountService.logout(token, readDailyLoginGrantCookie(request) ?? undefined);
    }
    clearSessionCookies(reply);
    await reply.code(204).send();
  });

  /**
   * FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61): the frozen
   * FreeAccessStatus read contract, derived server-side from the account's
   * existing Round5 FreeAccessSnapshot + the server clock -- never from
   * any client-supplied value. Same auth discipline as GET
   * /api/parent/session (session cookie only, no CSRF check needed for a
   * read). 404 (not 200 with nulls) if the account has no snapshot yet --
   * this should be structurally impossible for a session that just
   * validated (readSession already requires VERIFIED), but this route
   * fails closed rather than assuming it.
   */
  app.get('/api/parent/free-access-status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.freeAccessAccountRepository) {
      await reply.code(503).send({ error: 'not_configured' });
      return;
    }
    const token = readSessionCookie(request);
    if (token === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    try {
      const session = await parentAccountService.readSession(token);
      const row = await deps.freeAccessAccountRepository.findByAccountId(session.accountId);
      if (!row || row.freeAccess === null) {
        await reply.code(404).send({ error: 'not_found' });
        return;
      }
      const status = deriveFreeAccessStatus(row.freeAccess, new Date());
      await reply.code(200).send(status);
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/parent/sessions/revoke-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (!csrfOk(request)) {
      await reply.code(403).send({ error: 'csrf_mismatch' });
      return;
    }
    try {
      await parentAccountService.revokeAllSessions(token);
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return;
      }
      throw error;
    }
    clearSessionCookies(reply);
    await reply.code(204).send();
  });

  app.get('/api/parent/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.parentPreferenceRepository) return reply.code(503).send({ error: 'not_configured' });
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const session = await parentAccountService.readSession(token);
      return reply.code(200).send({ preferences: await deps.parentPreferenceRepository.get(session.accountId) });
    } catch (error) {
      if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
      throw error;
    }
  });

  app.patch('/api/parent/preferences', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.parentPreferenceRepository) return reply.code(503).send({ error: 'not_configured' });
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    if (!isPlainObject(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const body = request.body as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.some((key) => !['language', 'emailAlertsEnabled', 'pushRequestsEnabled', 'emailDestination'].includes(key)) || keys.length === 0) return reply.code(400).send({ error: 'invalid_request' });
    if (body.language !== undefined && body.language !== 'en' && body.language !== 'ar') return reply.code(400).send({ error: 'invalid_request' });
    if (body.emailAlertsEnabled !== undefined && typeof body.emailAlertsEnabled !== 'boolean') return reply.code(400).send({ error: 'invalid_request' });
    if (body.pushRequestsEnabled !== undefined && typeof body.pushRequestsEnabled !== 'boolean') return reply.code(400).send({ error: 'invalid_request' });
    if (body.emailDestination !== undefined && body.emailDestination !== null && (typeof body.emailDestination !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.emailDestination) || body.emailDestination.length > 320)) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const session = await parentAccountService.readSession(token);
      const patch: ParentPreferencesPatch = {
        language: body.language as ParentLanguage | undefined,
        emailAlertsEnabled: body.emailAlertsEnabled as boolean | undefined,
        pushRequestsEnabled: body.pushRequestsEnabled as boolean | undefined,
        emailDestination: body.emailDestination as string | null | undefined,
      };
      return reply.code(200).send({ preferences: await deps.parentPreferenceRepository.update(session.accountId, patch) });
    } catch (error) {
      if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
      throw error;
    }
  });

  async function familySession(request: FastifyRequest, reply: FastifyReply): Promise<{ accountId: string; familyId: string } | null> {
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
      return { accountId: session.accountId, familyId: session.familyId };
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return null;
      }
      throw error;
    }
  }

  function validOpaqueBase64(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length >= 2 && value.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function validSafeZoneBody(body: unknown): body is Omit<NewSafeZone, 'familyId'> {
    if (!isPlainObject(body)) return false;
    const value = body as Record<string, unknown>;
    return typeof value.recipientEndpointId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.recipientEndpointId)
      && validOpaqueBase64(value.ciphertextB64, 87380)
      && validOpaqueBase64(value.nonceB64, 88)
      && typeof value.keyEpoch === 'number' && Number.isInteger(value.keyEpoch) && value.keyEpoch > 0;
  }

  /**
   * SECURITY (actor-identity binding): `actorDeviceId` is derived
   * EXCLUSIVELY from a verified `DeviceSessionService` session token
   * presented as `Authorization: Bearer <token>` -- never from the raw
   * `x-pca-actor-device-id` header alone. That header was previously
   * regex-validated only (`/^[A-Za-z0-9_-]{1,128}$/`), with no
   * cryptographic or session binding to the actual caller: any
   * authenticated parent-web session could claim ANY deviceId string,
   * including another family member's or the Owner's, and have it
   * forwarded verbatim to `safeZonePolicyAuthorizer.authorize`. This is
   * safe ONLY as long as production wires `UnavailableTrustSetRoleResolver`
   * (which denies unconditionally); a real `FamilyTrustSetRoleResolver`
   * would turn the spoofed header into a genuine privilege-escalation/
   * impersonation path. See DeviceSessionService.requireActorDeviceInFamily
   * for the verification (proof-of-possession session token, scoped to the
   * caller's own already-authenticated family).
   *
   * The legacy header, if present, is cross-checked against the verified
   * identity and the request is REJECTED on any mismatch -- it is never
   * trusted over the session-derived value.
   */
  async function authorizeSafeZoneRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    session: { accountId: string; familyId: string },
    operation: 'VIEW_DASHBOARD' | 'EDIT_CHILD_POLICY',
    targetScope: { kind: 'FAMILY' | 'DEVICE'; id: string } = { kind: 'FAMILY', id: session.familyId },
  ): Promise<boolean> {
    if (!deps.safeZonePolicyAuthorizer || !deps.deviceSessionService) {
      await reply.code(503).send({ error: 'family_authority_unavailable' });
      return false;
    }
    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ') || authorizationHeader.length > 4096) {
      await reply.code(401).send({ error: 'actor_device_session_required' });
      return false;
    }
    let actorIdentity: { deviceId: string; familyId: string };
    try {
      actorIdentity = await deps.deviceSessionService.requireActorDeviceInFamily(authorizationHeader.slice('Bearer '.length), session.familyId);
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) {
        await reply.code(401).send({ error: 'actor_device_session_invalid' });
        return false;
      }
      throw error;
    }
    const legacyHeader = request.headers[ACTOR_DEVICE_HEADER];
    if (typeof legacyHeader === 'string' && legacyHeader.length > 0 && legacyHeader !== actorIdentity.deviceId) {
      await reply.code(403).send({ error: 'actor_device_mismatch' });
      return false;
    }
    const actorDeviceId = actorIdentity.deviceId;
    const issuedAt = new Date();
    const decision = await deps.safeZonePolicyAuthorizer.authorize({
      familyId: session.familyId,
      actorDeviceId,
      operation,
      targetScope,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 15 * 60 * 1000),
      stepUp: null,
      idempotencyKey: randomBytes(16).toString('hex'),
      actionId: randomBytes(16).toString('hex'),
    });
    const allowed = decision.verdict !== 'DENY' && (operation === 'VIEW_DASHBOARD' || decision.verdict === 'ALLOW');
    if (!allowed) {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  app.get('/api/parent/families/:familyId/safe-zones', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await authorizeSafeZoneRequest(request, reply, session, 'VIEW_DASHBOARD'))) return;
    return reply.code(200).send({ safeZones: await deps.safeZoneRepository.list(session.familyId) });
  });

  app.post('/api/parent/families/:familyId/safe-zones', { bodyLimit: MAX_SAFE_ZONE_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    const session = await familySession(request, reply);
    if (!session) return;
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    if (!validSafeZoneBody(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const body = request.body;
    if (!(await authorizeSafeZoneRequest(request, reply, session, 'EDIT_CHILD_POLICY', { kind: 'DEVICE', id: body.recipientEndpointId }))) return;
    const zone = await deps.safeZoneRepository.create({ ...body, familyId: session.familyId });
    return reply.code(201).send({ safeZone: zone });
  });

  app.patch('/api/parent/families/:familyId/safe-zones/:zoneId', { bodyLimit: MAX_SAFE_ZONE_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await authorizeSafeZoneRequest(request, reply, session, 'EDIT_CHILD_POLICY'))) return;
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    if (!isPlainObject(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const value = request.body as Record<string, unknown>;
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.some((key) => !['ciphertextB64', 'nonceB64', 'keyEpoch'].includes(key))) return reply.code(400).send({ error: 'invalid_request' });
    if (value.ciphertextB64 !== undefined && !validOpaqueBase64(value.ciphertextB64, 87380)) return reply.code(400).send({ error: 'invalid_request' });
    if (value.nonceB64 !== undefined && !validOpaqueBase64(value.nonceB64, 88)) return reply.code(400).send({ error: 'invalid_request' });
    if (value.keyEpoch !== undefined && (typeof value.keyEpoch !== 'number' || !Number.isInteger(value.keyEpoch) || value.keyEpoch <= 0)) return reply.code(400).send({ error: 'invalid_request' });
    const { zoneId } = request.params as { zoneId?: string };
    if (!zoneId || !/^[A-Za-z0-9_-]{1,128}$/.test(zoneId)) return reply.code(400).send({ error: 'invalid_request' });
    const existing = (await deps.safeZoneRepository.list(session.familyId)).find((zone) => zone.zoneId === zoneId);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (!(await authorizeSafeZoneRequest(request, reply, session, 'EDIT_CHILD_POLICY', { kind: 'DEVICE', id: existing.recipientEndpointId }))) return;
    try {
      const zone = await deps.safeZoneRepository.update(session.familyId, zoneId, value as SafeZonePatch);
      return reply.code(200).send({ safeZone: zone });
    } catch (error) {
      if (error instanceof SafeZoneError && error.code === 'NOT_FOUND') return reply.code(404).send({ error: 'not_found' });
      throw error;
    }
  });

  app.delete('/api/parent/families/:familyId/safe-zones/:zoneId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    const session = await familySession(request, reply);
    if (!session) return;
    if (!(await authorizeSafeZoneRequest(request, reply, session, 'EDIT_CHILD_POLICY'))) return;
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    const { zoneId } = request.params as { zoneId?: string };
    if (!zoneId || !/^[A-Za-z0-9_-]{1,128}$/.test(zoneId)) return reply.code(400).send({ error: 'invalid_request' });
    const existing = (await deps.safeZoneRepository.list(session.familyId)).find((zone) => zone.zoneId === zoneId);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (!(await authorizeSafeZoneRequest(request, reply, session, 'EDIT_CHILD_POLICY', { kind: 'DEVICE', id: existing.recipientEndpointId }))) return;
    const removed = await deps.safeZoneRepository.remove(session.familyId, zoneId);
    return removed ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });
}
