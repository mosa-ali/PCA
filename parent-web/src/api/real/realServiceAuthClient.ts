// Real, HTTP-backed ServiceAuthClient against PCA-AUTH-SESSION-1
// (PCA-DEC-026, FAMILY_SERVICE_SESSION_V1) -- the browser-reachable
// self-service parent registration/verification/login/session backend
// (backend/src/http/routes/parentAccountRoutes.ts). Genuine networking
// code, verified against that lane's own route source under the same
// worktree, not merely against the frozen contract doc alone.
//
// SESSION MODEL (CORRECTED from this file's prior speculative guess): the
// backend issues an HttpOnly, Secure-in-production, SameSite=Strict
// `pca_family_session` cookie -- never a JS-readable bearer token in a
// response body. Every request here uses `credentials: 'include'` so the
// browser attaches it automatically; this client never reads, stores, or
// forwards the session cookie's value itself (it structurally cannot --
// HttpOnly cookies are not exposed to `document.cookie`). State-changing
// routes (`logout`, and this domain's `sessions/revoke-all`, not yet
// exposed through this interface) additionally require a double-submit
// CSRF token: the NON-HttpOnly `pca_family_csrf` companion cookie, echoed
// in the `X-PCA-CSRF-Token` header -- `readCsrfCookie` below is the only
// cookie value this client ever touches, and only to echo it back, never
// to authenticate on its own.
//
// PATHS ARE `/api/parent/*`, NOT `/api/auth/*` -- the previous version of
// this file guessed at an `/api/auth/*` shape that was never implemented
// server-side. `/api/auth/step-up` in particular has no
// FAMILY_SERVICE_SESSION_V1 equivalent this round (no step-up route is
// part of this contract) -- stepUp() below honestly rejects rather than
// call a URL that doesn't exist.
//
import type { AuthenticatedSession, GenesisChallenge, GenesisCompletionInput, GenesisPlatform, RegistrationResult, RequestPasswordResetResult, ResetPasswordResult, ServiceAuthClient, SignInResult } from '../interfaces';
import type { ParentSignupProfile } from '../interfaces';
import { reportDiagnostic } from '../../security/diagnosticConsole';

export type ServiceAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'UNAUTHORIZED_FAMILY_SCOPE'
  | 'SESSION_EXPIRED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export class ServiceAuthError extends Error {
  readonly code: ServiceAuthErrorCode;

  constructor(code: ServiceAuthErrorCode, message: string) {
    super(message);
    this.name = 'ServiceAuthError';
    this.code = code;
  }
}

interface SessionResponseBody {
  accountId: string;
  familyId: string | null;
  emailVerified: true;
  role: 'ADMINISTRATOR' | 'VIEWER' | 'CHILD' | null;
}

interface EstablishedSessionResponseBody {
  accountId: string;
  familyId: string | null;
  sessionEstablished: true;
  role: 'ADMINISTRATOR' | 'VIEWER' | 'CHILD' | null;
}

interface StepUpRequiredResponseBody {
  sessionEstablished: false;
  stepUpRequired: true;
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function networkError(cause: unknown): ServiceAuthError {
  const message = cause instanceof Error ? cause.message : 'Network request failed';
  return new ServiceAuthError('NETWORK_ERROR', `Could not reach the PCA parent-account service: ${message}`);
}

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

/** Reads the NON-HttpOnly double-submit CSRF companion cookie -- see this file's header. Never reads/touches the HttpOnly session cookie (structurally impossible from JS). */
function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${CSRF_COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}

function toAuthenticatedSession(body: SessionResponseBody | EstablishedSessionResponseBody): AuthenticatedSession {
  const accountId = body.accountId;
  const familyId = body.familyId;
  const role = body.role;

  // The wire body has always been nullable (see SessionResponseBody /
  // EstablishedSessionResponseBody above) and matches the backend, whose
  // contract explicitly documents "`familyId` may be null if genesis is not
  // currently available". The previous version of this function contradicted
  // that by throwing for every role other than the three normal ones -- which
  // turned a SUCCESSFUL login step-up (HTTP 200, session cookie set, daily
  // grant issued) into `UNAUTHORIZED_FAMILY_SCOPE`, surfaced to the parent as
  // the generic "Unable to complete the action" message. The parent's login
  // was never failing.

  // GENUINELY INCONSISTENT: exactly one of familyId/role resolved. This is not
  // the pre-family state -- it is a server contract violation, and it is the
  // case `UNAUTHORIZED_FAMILY_SCOPE` is actually for. Keep it, so the code
  // retains a real inconsistent-authorization signal rather than swallowing
  // everything.
  if ((familyId === null) !== (role === null)) {
    throw new ServiceAuthError('UNAUTHORIZED_FAMILY_SCOPE', 'The family membership could not be resolved.');
  }

  // PRE-FAMILY ONBOARDING -- a legitimate authenticated state, NOT an error.
  // Modelled explicitly rather than bridged with an empty string or a fabricated
  // role (both of which the previous code did: `familyId: body.familyId ?? ''`).
  if (familyId === null || role === null) {
    reportDiagnostic('PARENT_SESSION_STATE', 'GENESIS_REQUIRED');
    return {
      state: 'GENESIS_REQUIRED',
      accountId,
      displayName: accountId,
      familyId: null,
      memberId: null,
      role: null,
      serviceAuthenticated: true,
    };
  }

  // Defensive: the wire type already restricts this, but a server that ever sent
  // a fourth role must not be silently trusted as family-ready.
  if (role !== 'ADMINISTRATOR' && role !== 'VIEWER' && role !== 'CHILD') {
    throw new ServiceAuthError('UNAUTHORIZED_FAMILY_SCOPE', 'The family membership could not be resolved.');
  }

  reportDiagnostic('PARENT_SESSION_STATE', 'FAMILY_READY');
  return {
    state: 'FAMILY_READY',
    accountId,
    displayName: accountId,
    familyId,
    memberId: accountId,
    role,
    serviceAuthenticated: true,
  };
}

/** Real HTTP implementation of ServiceAuthClient. Not fixture-backed. */
export class RealServiceAuthClient implements ServiceAuthClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async getSession(): Promise<AuthenticatedSession | null> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/session'), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw networkError(err);
    }

    if (response.status === 401) return null;
    if (!response.ok) {
      throw new ServiceAuthError('UNKNOWN', `Unexpected session check status ${response.status}`);
    }
    const body = await parseJsonSafe<SessionResponseBody>(response);
    if (!body) return null;
    return toAuthenticatedSession(body);
  }

  async register(email: string, password: string, passwordConfirmation: string, profile?: ParentSignupProfile): Promise<RegistrationResult> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/register'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirmation, ...profile }),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many registration attempts. Please try again later.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Registration request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected registration status ${response.status}`);
    const body = await parseJsonSafe<RegistrationResult>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Registration succeeded but the response was empty.');
    return body;
  }

  async verifyEmail(email: string, code: string): Promise<AuthenticatedSession> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/verify-email'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, code }),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That verification code is incorrect or has expired.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Verification request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected verify-email status ${response.status}`);
    const body = await parseJsonSafe<EstablishedSessionResponseBody>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Verification succeeded but the response was empty.');
    return toAuthenticatedSession(body);
  }

  async requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/request-password-reset'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Password reset request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected request-password-reset status ${response.status}`);
    const body = await parseJsonSafe<RequestPasswordResetResult>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Password reset request succeeded but the response was empty.');
    return body;
  }

  async resetPassword(email: string, code: string, newPassword: string, newPasswordConfirmation: string): Promise<ResetPasswordResult> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/reset-password'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, code, newPassword, newPasswordConfirmation }),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That reset code is incorrect or has expired.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Password reset request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected reset-password status ${response.status}`);
    const body = await parseJsonSafe<ResetPasswordResult>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Password reset succeeded but the response was empty.');
    return body;
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        // `password` is sent only in this single request body, over the
        // fetch call's TLS connection, and is never assigned anywhere else.
        body: JSON.stringify({ email, password }),
      });
    } catch (err) {
      throw networkError(err);
    }

    if (response.status === 429) {
      throw new ServiceAuthError('RATE_LIMITED', 'Too many sign-in attempts. Please try again later.');
    }
    if (response.status === 401) {
      throw new ServiceAuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (!response.ok) {
      throw new ServiceAuthError('UNKNOWN', `Unexpected sign-in status ${response.status}`);
    }

    const body = await parseJsonSafe<EstablishedSessionResponseBody | StepUpRequiredResponseBody>(response);
    if (!body) {
      throw new ServiceAuthError('UNKNOWN', 'Sign-in succeeded but the session response was empty.');
    }
    if (body.sessionEstablished === false) {
      return { status: 'STEP_UP_REQUIRED' };
    }
    return { status: 'AUTHENTICATED', session: toAuthenticatedSession(body) };
  }

  /** Consumes the one-time emailed login step-up code (see signIn's STEP_UP_REQUIRED result). */
  async completeLoginStepUp(email: string, code: string): Promise<AuthenticatedSession> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/login/step-up'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, code }),
      });
    } catch (err) {
      throw networkError(err);
    }

    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That code is incorrect or has expired.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Step-up request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected login step-up status ${response.status}`);
    const body = await parseJsonSafe<EstablishedSessionResponseBody>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Step-up succeeded but the session response was empty.');
    // PARENT_LOGIN_STEP_UP_STAGE is emitted as SESSION_ISSUED only. Its sibling
    // stage DAILY_GRANT_PERSISTED is deliberately NOT emitted here: the daily
    // login grant cookie (`dailyLoginGrantCookieName()`) is set HttpOnly, so
    // this client cannot observe whether it was persisted, and asserting it
    // would be an unverifiable claim rather than a diagnostic. The grant is
    // written server-side in the same request, and ParentAccountService rolls
    // the new session back if that write fails -- so HTTP 200 here does mean
    // both happened, but only the SERVER can honestly report the second stage.
    reportDiagnostic('PARENT_LOGIN_STEP_UP_STAGE', 'SESSION_ISSUED');
    return toAuthenticatedSession(body);
  }

  /**
   * FAMILY GENESIS (PCA-DEC-020-R1). Four steps, each bound to the SAME session
   * the first one ran under: the backend records the session that requested the
   * step-up and requires the ceremony to complete under it.
   *
   * Every request carries the double-submit CSRF header and `credentials:
   * 'include'`, like every other state-changing call in this client. Stage
   * diagnostics are emitted through the sanctioned `reportDiagnostic` sink and
   * carry STATUS ONLY -- never a password, code, token, cookie, or signature.
   */
  async startGenesisStepUp(email: string, password: string): Promise<void> {
    const response = await this.genesisPost('/api/parent/genesis/step-up', { email, password });
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'Password confirmation failed.');
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 403) throw new ServiceAuthError('INVALID_REQUEST', 'Request could not be authorised.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Genesis step-up request was invalid.');
    // 202 Accepted -- NOT 200. A client that only accepts 200 silently
    // reports failure for a request the server accepted.
    if (response.status !== 202) throw new ServiceAuthError('UNKNOWN', `Unexpected genesis step-up status ${response.status}`);
    reportDiagnostic('PARENT_GENESIS_STAGE', 'STEP_UP_REQUIRED');
  }

  async completeGenesisStepUp(code: string): Promise<void> {
    const response = await this.genesisPost('/api/parent/genesis/step-up/complete', { code });
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That code is incorrect or has expired.');
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 403) throw new ServiceAuthError('INVALID_REQUEST', 'Request could not be authorised.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Genesis step-up request was invalid.');
    if (response.status !== 200) throw new ServiceAuthError('UNKNOWN', `Unexpected genesis step-up completion status ${response.status}`);
    reportDiagnostic('PARENT_GENESIS_STAGE', 'STEP_UP_VERIFIED');
  }

  async requestGenesisChallenge(publicKey: string, platform: GenesisPlatform): Promise<GenesisChallenge> {
    const response = await this.genesisPost('/api/parent/genesis/challenge', { publicKey, platform });
    if (response.status === 401) throw new ServiceAuthError('SESSION_EXPIRED', 'Your session is no longer valid.');
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 403) throw new ServiceAuthError('INVALID_REQUEST', 'Request could not be authorised.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'The device key could not be registered.');
    if (response.status === 503) throw new ServiceAuthError('NOT_IMPLEMENTED', 'Family setup is not available right now.');
    // 201 Created -- the challenge is a newly created server resource.
    if (response.status !== 201) throw new ServiceAuthError('UNKNOWN', `Unexpected genesis challenge status ${response.status}`);
    const body = await parseJsonSafe<GenesisChallenge>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Genesis challenge was empty.');
    reportDiagnostic('PARENT_GENESIS_STAGE', 'CHALLENGE_CREATED');
    return body;
  }

  async completeGenesis(input: GenesisCompletionInput): Promise<void> {
    const response = await this.genesisPost('/api/parent/genesis/complete', input);
    if (response.status === 401) throw new ServiceAuthError('SESSION_EXPIRED', 'Your session is no longer valid.');
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 403) throw new ServiceAuthError('INVALID_REQUEST', 'Request could not be authorised.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'The family setup request was rejected.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected genesis completion status ${response.status}`);
    reportDiagnostic('PARENT_GENESIS_STAGE', 'COMPLETED');
  }

  /** Shared POST for the four genesis calls: same-origin credentials, JSON body, double-submit CSRF header. */
  private async genesisPost(path: string, body: unknown): Promise<Response> {
    const csrfToken = readCsrfCookie();
    try {
      return await fetch(this.url(path), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw networkError(err);
    }
  }

  async signOut(): Promise<void> {
    const csrfToken = readCsrfCookie();
    try {
      await fetch(this.url('/api/parent/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : undefined,
      });
    } catch (err) {
      // Sign-out is best-effort from the client's perspective -- surface a
      // typed error but never leave stale client state pretending we're
      // still authenticated; callers should still clear local UI state.
      throw networkError(err);
    }
  }

  /**
   * FAMILY_SERVICE_SESSION_V1 defines no step-up route this round -- rather
   * than call a URL that was never built, or throw (StepUpContext.tsx's
   * confirm handler does not catch a rejection, so throwing here would
   * break that UI flow), this honestly reports "never granted": every
   * step-up-gated action stays blocked until a real step-up capability
   * exists, which is the fail-closed, safe default.
   */
  async stepUp(_actionId: string): Promise<{ granted: boolean; expiresAtUtc: string }> {
    return { granted: false, expiresAtUtc: new Date().toISOString() };
  }
}
