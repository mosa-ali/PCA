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
import { createKeyedRateLimiter } from '../../parentaccount/rateLimiter.js';
import { hashParentEmail } from '../../parentaccount/emailHash.js';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  isProductionEnvironment,
  parseCookies,
  serializeCookie,
  serializeExpiredCookie,
} from '../../parentaccount/cookies.js';
import {
  LOGIN_EMAIL_RATE_LIMIT,
  LOGIN_IP_RATE_LIMIT,
  REGISTER_EMAIL_RATE_LIMIT,
  REGISTER_IP_RATE_LIMIT,
  VERIFY_EMAIL_RATE_LIMIT,
  VERIFY_IP_RATE_LIMIT,
} from '../../parentaccount/policy.js';
import { deriveFreeAccessStatus } from '../../parentaccount/freeaccess/deriveFreeAccessStatus.js';
import type { FreeAccessAccountRepository } from '../../parentaccount/freeaccess/FreeAccessAccountRepository.js';
import type { ParentPreferenceRepository, ParentPreferencesPatch, ParentLanguage } from '../../parentaccount/ParentPreferenceRepository.js';
import { SafeZoneError, type NewSafeZone, type SafeZonePatch, type SafeZoneRepository } from '../../location/SafeZoneRepository.js';

const MAX_BODY_BYTES = 4 * 1024;
const CSRF_TOKEN_BYTES = 32;

export interface ParentAccountRoutesDeps {
  parentAccountService: ParentAccountService;
  parentPreferenceRepository?: ParentPreferenceRepository;
  safeZoneRepository?: SafeZoneRepository;
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

function setSessionCookies(reply: FastifyReply, rawSessionToken: string): string {
  const secure = isProductionEnvironment();
  const csrfToken = generateCsrfToken();
  reply.header('Set-Cookie', [
    serializeCookie(SESSION_COOKIE_NAME, rawSessionToken, { httpOnly: true, secure, maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS }),
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, { httpOnly: false, secure, maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS }),
  ]);
  return csrfToken;
}

function clearSessionCookies(reply: FastifyReply): void {
  const secure = isProductionEnvironment();
  reply.header('Set-Cookie', [
    serializeExpiredCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure }),
    serializeExpiredCookie(CSRF_COOKIE_NAME, { httpOnly: false, secure }),
  ]);
}

function readSessionCookie(request: FastifyRequest): string | null {
  const cookies = parseCookies(request.headers.cookie);
  return cookies.get(SESSION_COOKIE_NAME) ?? null;
}

/** Double-submit CSRF check: the `pca_family_csrf` cookie value must exactly match the `X-PCA-CSRF-Token` header. Cookie presence alone (without the header, or with a mismatched header) never passes -- an attacker's cross-origin form/fetch can trigger the cookie to be sent automatically but cannot read it to also set the matching header, and SameSite=Strict additionally blocks the cookie from even being attached on a cross-site navigation/request. */
function csrfOk(request: FastifyRequest): boolean {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies.get(CSRF_COOKIE_NAME);
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
    const { email, password, passwordConfirmation } = request.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string' || typeof passwordConfirmation !== 'string') {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    if (!rateLimited('register', REGISTER_IP_RATE_LIMIT, REGISTER_EMAIL_RATE_LIMIT, request.ip, email)) {
      await reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    try {
      const result = await parentAccountService.register(email, password, passwordConfirmation);
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
      await reply.code(200).send({ accountId: result.accountId, familyId: result.familyId, sessionEstablished: true });
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
      const result = await parentAccountService.login(email, password);
      setSessionCookies(reply, result.rawSessionToken);
      await reply.code(200).send({ accountId: result.accountId, familyId: result.familyId, sessionEstablished: true });
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'invalid_credentials' });
        return;
      }
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

  app.post('/api/parent/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token !== null && !csrfOk(request)) {
      await reply.code(403).send({ error: 'csrf_mismatch' });
      return;
    }
    if (token !== null) {
      await parentAccountService.logout(token);
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
    if (keys.some((key) => !['language', 'emailAlertsEnabled', 'pushRequestsEnabled'].includes(key)) || keys.length === 0) return reply.code(400).send({ error: 'invalid_request' });
    if (body.language !== undefined && body.language !== 'en' && body.language !== 'ar') return reply.code(400).send({ error: 'invalid_request' });
    if (body.emailAlertsEnabled !== undefined && typeof body.emailAlertsEnabled !== 'boolean') return reply.code(400).send({ error: 'invalid_request' });
    if (body.pushRequestsEnabled !== undefined && typeof body.pushRequestsEnabled !== 'boolean') return reply.code(400).send({ error: 'invalid_request' });
    try {
      const session = await parentAccountService.readSession(token);
      const patch: ParentPreferencesPatch = {
        language: body.language as ParentLanguage | undefined,
        emailAlertsEnabled: body.emailAlertsEnabled as boolean | undefined,
        pushRequestsEnabled: body.pushRequestsEnabled as boolean | undefined,
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

  function validSafeZoneBody(body: unknown): body is Omit<NewSafeZone, 'familyId'> {
    if (!isPlainObject(body)) return false;
    const value = body as Record<string, unknown>;
    return typeof value.childProfileId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.childProfileId)
      && typeof value.label === 'string' && value.label.trim().length >= 1 && value.label.length <= 80
      && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90
      && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180
      && typeof value.radiusMeters === 'number' && Number.isInteger(value.radiusMeters) && value.radiusMeters >= 50 && value.radiusMeters <= 100000
      && (value.enabled === undefined || typeof value.enabled === 'boolean');
  }

  app.get('/api/parent/families/:familyId/safe-zones', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    const session = await familySession(request, reply);
    if (!session) return;
    return reply.code(200).send({ safeZones: await deps.safeZoneRepository.list(session.familyId) });
  });

  app.post('/api/parent/families/:familyId/safe-zones', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    const session = await familySession(request, reply);
    if (!session) return;
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    if (!validSafeZoneBody(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const body = request.body;
    try {
      const zone = await deps.safeZoneRepository.create({ ...body, familyId: session.familyId, enabled: body.enabled ?? true });
      return reply.code(201).send({ safeZone: zone });
    } catch (error) {
      if (error instanceof SafeZoneError && error.code === 'CHILD_NOT_IN_FAMILY') return reply.code(403).send({ error: 'child_scope_forbidden' });
      throw error;
    }
  });

  app.patch('/api/parent/families/:familyId/safe-zones/:zoneId', { bodyLimit: MAX_BODY_BYTES }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    const session = await familySession(request, reply);
    if (!session) return;
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    if (!isPlainObject(request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const value = request.body as Record<string, unknown>;
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.some((key) => !['label', 'latitude', 'longitude', 'radiusMeters', 'enabled'].includes(key))) return reply.code(400).send({ error: 'invalid_request' });
    if (value.label !== undefined && (typeof value.label !== 'string' || value.label.trim().length < 1 || value.label.length > 80)) return reply.code(400).send({ error: 'invalid_request' });
    if (value.latitude !== undefined && (typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90)) return reply.code(400).send({ error: 'invalid_request' });
    if (value.longitude !== undefined && (typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180)) return reply.code(400).send({ error: 'invalid_request' });
    if (value.radiusMeters !== undefined && (typeof value.radiusMeters !== 'number' || !Number.isInteger(value.radiusMeters) || value.radiusMeters < 50 || value.radiusMeters > 100000)) return reply.code(400).send({ error: 'invalid_request' });
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_request' });
    const { zoneId } = request.params as { zoneId?: string };
    if (!zoneId || !/^[A-Za-z0-9_-]{1,128}$/.test(zoneId)) return reply.code(400).send({ error: 'invalid_request' });
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
    if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
    const { zoneId } = request.params as { zoneId?: string };
    if (!zoneId || !/^[A-Za-z0-9_-]{1,128}$/.test(zoneId)) return reply.code(400).send({ error: 'invalid_request' });
    const removed = await deps.safeZoneRepository.remove(session.familyId, zoneId);
    return removed ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });
}
