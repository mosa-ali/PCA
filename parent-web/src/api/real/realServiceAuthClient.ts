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
// KNOWN GAP (see this lane's final report): `AuthenticatedSession.role`/
// `memberId`/`displayName` are NOT part of FAMILY_SERVICE_SESSION_V1's
// response shape (`{accountId, familyId, emailVerified}` /
// `{accountId, familyId, sessionEstablished}`) -- a service session proves
// account identity only, never family role (this mirrors
// ../../domain/roles.ts's own documented stance: FamilyRole is a
// client-side UX heuristic, never server-authoritative, real enforcement
// is server/device-side). For a session established via THIS flow's own
// verifyEmail (the family-genesis path), the caller is, by construction,
// that family's initial Owner (PCA-DEC-026 step 4) -- so `role: 'OWNER'`
// is filled in honestly for that path. For signIn() (an ordinary
// subsequent login), no such guarantee exists; role is left as 'VIEWER'
// (the least-privileged placeholder) until a real role-resolution capability
// exists. `displayName`/`memberId` are not resolvable at all yet and are
// filled with clearly-synthetic placeholders derived from `accountId`.
import type { AuthenticatedSession, RegistrationResult, ServiceAuthClient } from '../interfaces';

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
}

interface EstablishedSessionResponseBody {
  accountId: string;
  familyId: string | null;
  sessionEstablished: true;
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

function toAuthenticatedSession(body: SessionResponseBody | EstablishedSessionResponseBody, assumedRole: 'OWNER' | 'VIEWER'): AuthenticatedSession {
  return {
    accountId: body.accountId,
    // KNOWN GAP -- see this file's header. Not resolvable from
    // FAMILY_SERVICE_SESSION_V1's response shape yet.
    displayName: body.accountId,
    familyId: body.familyId ?? '',
    memberId: body.accountId,
    role: assumedRole,
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
    // A caller with no familyId yet (genesis unavailable / not-yet-a-member)
    // cannot honestly be called 'OWNER' -- least-privilege placeholder.
    return toAuthenticatedSession(body, body.familyId ? 'OWNER' : 'VIEWER');
  }

  async register(email: string, password: string, passwordConfirmation: string): Promise<RegistrationResult> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/register'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirmation }),
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
    // A session established via verify-email is, by construction, the
    // family's initial Owner (PCA-DEC-026 step 4) when genesis succeeded.
    return toAuthenticatedSession(body, body.familyId ? 'OWNER' : 'VIEWER');
  }

  async signIn(email: string, password: string): Promise<AuthenticatedSession> {
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

    const body = await parseJsonSafe<EstablishedSessionResponseBody>(response);
    if (!body) {
      throw new ServiceAuthError('UNKNOWN', 'Sign-in succeeded but the session response was empty.');
    }
    // Ordinary sign-in gives no server-side role signal at all (see this
    // file's header) -- least-privilege placeholder until a real
    // role-resolution capability exists.
    return toAuthenticatedSession(body, 'VIEWER');
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
