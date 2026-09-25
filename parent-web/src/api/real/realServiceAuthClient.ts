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
// server-side. The generic family-action stepUp() below has no route and
// honestly never grants; the COMMERCIAL step-up is the authenticator-code
// route `/api/parent/mfa/step-up` (issueCommercialStepUp).
//
// PCA-DEC-037 AUTHENTICATOR MFA: sign-in is email + password, then either an
// emailed code (accounts without an authenticator app) or the app's 6-digit
// code. Enrollment material (otpauth URI + secret) and commercial step-up
// tokens are returned to the caller ONLY -- this client never stores or logs
// them. Diagnostics carry status words only.
//
import type {
  AuthenticatedSession,
  CommercialStepUpGrant,
  CommercialStepUpOperation,
  LoginStepUpResult,
  MfaRecoveryCompletionResult,
  MfaEnrollmentConfirmResult,
  MfaEnrollmentStart,
  ParentMfaStatus,
  ParentSignupProfile,
  RegistrationResult,
  RequestPasswordResetResult,
  ResetPasswordResult,
  ServiceAuthClient,
  SignInResult,
  VerifyEmailResult,
} from '../interfaces';
import { reportDiagnostic } from '../../security/diagnosticConsole';

export type ServiceAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  /** The authenticator-app code was wrong (sign-in, enrollment confirm or commercial step-up). */
  | 'INVALID_MFA_CODE'
  /** Too many wrong authenticator codes: the server has locked authenticator checks for a while (15 minutes). */
  | 'MFA_LOCKED'
  /** The account may not perform this (e.g. a commercial step-up by a non-administrator, or without an authenticator). */
  | 'FORBIDDEN'
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

type WireRole = 'ADMINISTRATOR' | 'VIEWER' | 'CHILD' | null;

interface WireMfa {
  status?: unknown;
  graceExpiresAt?: unknown;
}

interface SessionResponseBody {
  accountId: string;
  familyId: string | null;
  emailVerified?: true;
  role: WireRole;
  mfa?: WireMfa;
}

interface SignInResponseBody {
  accountId?: string;
  familyId?: string | null;
  role?: WireRole;
  mfa?: WireMfa;
  sessionEstablished?: boolean;
  stepUpRequired?: boolean;
  mfaRequired?: boolean;
  recoveryPending?: boolean;
  recoveryAvailableAt?: string;
  mfaSetupRequired?: boolean;
}

interface ErrorBody {
  error?: string;
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function errorCodeOf(response: Response): Promise<string | null> {
  const body = await parseJsonSafe<ErrorBody>(response);
  return typeof body?.error === 'string' ? body.error : null;
}

function networkError(cause: unknown): ServiceAuthError {
  const message = cause instanceof Error ? cause.message : 'Network request failed';
  return new ServiceAuthError('NETWORK_ERROR', `Could not reach the PCA account service: ${message}`);
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

function toMfaStatus(wire: WireMfa | undefined): ParentMfaStatus {
  if (wire && wire.status === 'ACTIVE') return { status: 'ACTIVE' };
  if (wire && (wire.status === 'GRACE' || wire.status === 'SETUP_REQUIRED') && typeof wire.graceExpiresAt === 'string' && !Number.isNaN(Date.parse(wire.graceExpiresAt))) {
    return { status: wire.status, graceExpiresAt: wire.graceExpiresAt };
  }
  // The server always sends this object (PCA-DEC-037). A missing or malformed
  // one is a contract violation, and guessing either way would be wrong:
  // "ACTIVE" would hide a mandatory setup, anything else would invent a
  // deadline the server never issued.
  throw new ServiceAuthError('UNKNOWN', 'The session response did not include a valid authenticator status.');
}

/**
 * Maps a session body onto the single established-session shape. Since
 * PCA-DEC-037 the family is provisioned server-side at first sign-in, so a
 * body without a family or role is a server contract violation and is
 * rejected (fail closed) -- never bridged with a fabricated family or role.
 */
function toAuthenticatedSession(body: { accountId?: string; familyId?: string | null; role?: WireRole; mfa?: WireMfa }): AuthenticatedSession {
  const { accountId, familyId, role } = body;
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new ServiceAuthError('UNKNOWN', 'The session response was incomplete.');
  }
  if (typeof familyId !== 'string' || familyId.length === 0 || (role !== 'ADMINISTRATOR' && role !== 'VIEWER' && role !== 'CHILD')) {
    throw new ServiceAuthError('UNAUTHORIZED_FAMILY_SCOPE', 'The family membership could not be resolved.');
  }
  const mfa = toMfaStatus(body.mfa);
  reportDiagnostic('PARENT_SESSION_STATE', 'ESTABLISHED');
  return {
    accountId,
    displayName: accountId,
    familyId,
    memberId: accountId,
    role,
    serviceAuthenticated: true,
    mfa,
  };
}

/** Real HTTP implementation of ServiceAuthClient. Not fixture-backed. */
export class RealServiceAuthClient implements ServiceAuthClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  /** JSON POST with credentials. `withCsrf` echoes the double-submit CSRF cookie for session-authenticated routes. */
  private async post(path: string, body: unknown, withCsrf = false): Promise<Response> {
    const csrfToken = withCsrf ? readCsrfCookie() : null;
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
    const response = await this.post('/api/parent/register', { email, password, passwordConfirmation, ...profile });
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many registration attempts. Please try again later.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Registration request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected registration status ${response.status}`);
    const body = await parseJsonSafe<RegistrationResult>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Registration succeeded but the response was empty.');
    return body;
  }

  /** Activates the account. Establishes NO session (PCA-DEC-037): the parent signs in next. */
  async verifyEmail(email: string, code: string): Promise<VerifyEmailResult> {
    const response = await this.post('/api/parent/verify-email', { email, code });
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That verification code is incorrect or has expired.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Verification request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected verify-email status ${response.status}`);
    return { status: 'VERIFIED' };
  }

  async requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
    const response = await this.post('/api/parent/request-password-reset', { email });
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Password reset request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected request-password-reset status ${response.status}`);
    const body = await parseJsonSafe<RequestPasswordResetResult>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Password reset request succeeded but the response was empty.');
    return body;
  }

  async resetPassword(email: string, code: string, newPassword: string, newPasswordConfirmation: string): Promise<ResetPasswordResult> {
    const response = await this.post('/api/parent/reset-password', { email, code, newPassword, newPasswordConfirmation });
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That reset code is incorrect or has expired.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Password reset request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected reset-password status ${response.status}`);
    const body = await parseJsonSafe<ResetPasswordResult>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Password reset succeeded but the response was empty.');
    return body;
  }

  async signIn(email: string, password: string, totpCode?: string): Promise<SignInResult> {
    // `password` (and `totpCode`) are sent only in this single request body,
    // over the fetch call's TLS connection, and are never assigned anywhere else.
    const response = await this.post('/api/parent/login', totpCode === undefined ? { email, password } : { email, password, totpCode });

    if (response.status === 429) {
      if ((await errorCodeOf(response)) === 'mfa_locked') {
        throw new ServiceAuthError('MFA_LOCKED', 'Too many incorrect authenticator codes. Please wait before trying again.');
      }
      throw new ServiceAuthError('RATE_LIMITED', 'Too many sign-in attempts. Please try again later.');
    }
    if (response.status === 401) {
      if ((await errorCodeOf(response)) === 'invalid_mfa_code') {
        throw new ServiceAuthError('INVALID_MFA_CODE', 'That authenticator code is incorrect.');
      }
      throw new ServiceAuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Sign-in request was invalid.');
    if (!response.ok) {
      throw new ServiceAuthError('UNKNOWN', `Unexpected sign-in status ${response.status}`);
    }

    const body = await parseJsonSafe<SignInResponseBody>(response);
    if (!body) {
      throw new ServiceAuthError('UNKNOWN', 'Sign-in succeeded but the session response was empty.');
    }
    if (body.sessionEstablished === true) {
      return { status: 'AUTHENTICATED', session: toAuthenticatedSession(body) };
    }
    if (body.mfaRequired === true) {
      reportDiagnostic('PARENT_LOGIN_STAGE', 'MFA_REQUIRED');
      return { status: 'MFA_REQUIRED' };
    }
    if (body.recoveryPending === true && typeof body.recoveryAvailableAt === 'string') {
      reportDiagnostic('PARENT_LOGIN_STAGE', 'MFA_RECOVERY_PENDING');
      return { status: 'MFA_RECOVERY_PENDING', recoveryAvailableAt: body.recoveryAvailableAt };
    }
    if (body.stepUpRequired === true) {
      reportDiagnostic('PARENT_LOGIN_STAGE', 'STEP_UP_REQUIRED');
      return { status: 'STEP_UP_REQUIRED' };
    }
    throw new ServiceAuthError('UNKNOWN', 'Sign-in returned an unrecognised response.');
  }

  /** Consumes the one-time emailed login step-up code (see signIn's STEP_UP_REQUIRED result). */
  async completeLoginStepUp(email: string, code: string): Promise<LoginStepUpResult> {
    const response = await this.post('/api/parent/login/step-up', { email, code });
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That code is incorrect or has expired.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Step-up request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected login step-up status ${response.status}`);
    const body = await parseJsonSafe<SignInResponseBody>(response);
    if (!body) throw new ServiceAuthError('UNKNOWN', 'Step-up succeeded but the session response was empty.');
    if (body.sessionEstablished !== true && body.mfaSetupRequired === true) {
      // Grace period over: the server set an HttpOnly enrollment ticket and
      // deliberately issued NO session. The caller goes straight to setup.
      reportDiagnostic('PARENT_LOGIN_STEP_UP_STAGE', 'MFA_SETUP_REQUIRED');
      return { status: 'MFA_SETUP_REQUIRED' };
    }
    if (body.sessionEstablished !== true) throw new ServiceAuthError('UNKNOWN', 'Step-up returned an unrecognised response.');
    // The daily login grant cookie is HttpOnly, so only the SESSION_ISSUED
    // stage is observable (and therefore reportable) from here.
    reportDiagnostic('PARENT_LOGIN_STEP_UP_STAGE', 'SESSION_ISSUED');
    return { status: 'AUTHENTICATED', session: toAuthenticatedSession(body) };
  }

  /**
   * The enrollment routes accept either the HttpOnly enrollment ticket (sent
   * automatically as a cookie) or the session cookie plus CSRF header. The
   * CSRF header is echoed whenever its cookie exists; on the ticket path no
   * CSRF cookie exists (the server clears the session cookies when it issues
   * a ticket), so nothing is sent.
   */
  async startMfaEnrollment(email: string, password: string): Promise<MfaEnrollmentStart> {
    const response = await this.post('/api/parent/mfa/enrollment/start', { email, password }, true);
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'Email or password is incorrect, or the setup session has expired.');
    if (response.status === 403) throw new ServiceAuthError('FORBIDDEN', 'Authenticator setup is not permitted right now.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Authenticator setup request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected enrollment start status ${response.status}`);
    const body = await parseJsonSafe<{ otpauthUri?: unknown; secret?: unknown }>(response);
    if (!body || typeof body.otpauthUri !== 'string' || typeof body.secret !== 'string' || !body.otpauthUri.startsWith('otpauth://')) {
      throw new ServiceAuthError('UNKNOWN', 'Authenticator setup response was incomplete.');
    }
    reportDiagnostic('PARENT_MFA_ENROLLMENT_STAGE', 'STARTED');
    return { otpauthUri: body.otpauthUri, secret: body.secret };
  }

  async confirmMfaEnrollment(email: string, code: string): Promise<MfaEnrollmentConfirmResult> {
    const response = await this.post('/api/parent/mfa/enrollment/confirm', { email, code }, true);
    if (response.status === 429) {
      if ((await errorCodeOf(response)) === 'mfa_locked') throw new ServiceAuthError('MFA_LOCKED', 'Too many incorrect authenticator codes. Please wait before trying again.');
      throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    }
    if (response.status === 401) {
      if ((await errorCodeOf(response)) === 'invalid_mfa_code') throw new ServiceAuthError('INVALID_MFA_CODE', 'That authenticator code is incorrect.');
      throw new ServiceAuthError('SESSION_EXPIRED', 'The setup session has expired. Please sign in again.');
    }
    if (response.status === 403) throw new ServiceAuthError('FORBIDDEN', 'Authenticator setup is not permitted right now.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Authenticator confirmation request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected enrollment confirm status ${response.status}`);
    const body = await parseJsonSafe<{ enrolled?: unknown; sessionEstablished?: unknown }>(response);
    if (!body || body.enrolled !== true) throw new ServiceAuthError('UNKNOWN', 'Authenticator confirmation response was incomplete.');
    reportDiagnostic('PARENT_MFA_ENROLLMENT_STAGE', 'CONFIRMED');
    return { sessionEstablished: body.sessionEstablished === true };
  }

  async requestMfaRecovery(email: string, password: string): Promise<void> {
    const response = await this.post('/api/parent/mfa/recovery/request', { email, password });
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Recovery request was invalid.');
    // 202, identical whatever happened: never an account/password oracle.
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected recovery request status ${response.status}`);
  }

  async completeMfaRecovery(email: string, password: string, code: string): Promise<MfaRecoveryCompletionResult> {
    const response = await this.post('/api/parent/mfa/recovery/complete', { email, password, code });
    if (response.status === 429) throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    if (response.status === 401) throw new ServiceAuthError('INVALID_CREDENTIALS', 'That recovery code is incorrect or has expired.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Recovery request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected recovery completion status ${response.status}`);
    const body = await parseJsonSafe<{ status?: unknown; recoveryAvailableAt?: unknown; mfaSetupRequired?: unknown }>(response);
    if (body?.status === 'MFA_RECOVERY_PENDING' && typeof body.recoveryAvailableAt === 'string') {
      reportDiagnostic('PARENT_MFA_RECOVERY_STAGE', 'RECOVERY_PENDING');
      return { status: 'MFA_RECOVERY_PENDING', recoveryAvailableAt: body.recoveryAvailableAt };
    }
    if (body?.status !== 'MFA_SETUP_REQUIRED' || body.mfaSetupRequired !== true) throw new ServiceAuthError('UNKNOWN', 'Recovery response was incomplete.');
    reportDiagnostic('PARENT_MFA_RECOVERY_STAGE', 'SETUP_REQUIRED');
    return { status: 'MFA_SETUP_REQUIRED' };
  }

  async issueCommercialStepUp(operation: CommercialStepUpOperation, code: string): Promise<CommercialStepUpGrant> {
    const response = await this.post('/api/parent/mfa/step-up', { operation, code }, true);
    if (response.status === 429) {
      if ((await errorCodeOf(response)) === 'mfa_locked') throw new ServiceAuthError('MFA_LOCKED', 'Too many incorrect authenticator codes. Please wait before trying again.');
      throw new ServiceAuthError('RATE_LIMITED', 'Too many attempts. Please try again later.');
    }
    if (response.status === 401) {
      if ((await errorCodeOf(response)) === 'invalid_mfa_code') throw new ServiceAuthError('INVALID_MFA_CODE', 'That authenticator code is incorrect.');
      throw new ServiceAuthError('SESSION_EXPIRED', 'Your session is no longer valid.');
    }
    if (response.status === 403) throw new ServiceAuthError('FORBIDDEN', 'This action is not permitted for your account.');
    if (response.status === 400) throw new ServiceAuthError('INVALID_REQUEST', 'Confirmation request was invalid.');
    if (!response.ok) throw new ServiceAuthError('UNKNOWN', `Unexpected step-up status ${response.status}`);
    const body = await parseJsonSafe<{ stepUpToken?: unknown; operation?: unknown; expiresAt?: unknown }>(response);
    if (!body || typeof body.stepUpToken !== 'string' || body.stepUpToken.length === 0 || body.operation !== operation || typeof body.expiresAt !== 'string') {
      throw new ServiceAuthError('UNKNOWN', 'Step-up response was incomplete.');
    }
    reportDiagnostic('PARENT_COMMERCIAL_STEP_UP_STAGE', 'GRANTED');
    return { stepUpToken: body.stepUpToken, operation, expiresAt: body.expiresAt };
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
   * No generic (non-commercial) family-action step-up route exists -- rather
   * than call a URL that was never built, or throw (StepUpContext.tsx's
   * confirm handler does not catch a rejection), this honestly reports
   * "never granted": every such step-up-gated family action stays blocked,
   * the fail-closed default. Commercial actions use issueCommercialStepUp.
   */
  async stepUp(_actionId: string): Promise<{ granted: boolean; expiresAtUtc: string }> {
    return { granted: false, expiresAtUtc: new Date().toISOString() };
  }
}
