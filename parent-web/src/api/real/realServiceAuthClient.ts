// Real, HTTP-backed ServiceAuthClient. This is genuine networking code (not
// a fixture) -- it is safe to construct and call today, but there is no
// live backend to answer it yet in this repository slice (see
// docs/architecture and the KNOWN_BACKEND_INTEGRATION_ACTION note in
// ../client.ts). No live-server integration test exists for this reason;
// coverage here is at the fetch-mock unit level.
//
// EXPECTED BACKEND CONTRACT (conventional REST, all under `${apiBaseUrl}`):
//   GET  /api/auth/session   -> 200 AuthenticatedSession | 401 (no session)
//   POST /api/auth/login     body { email, password } -> 200 AuthenticatedSession
//                             | 401 invalid credentials
//                             | 403 { code: 'ACCOUNT_DISABLED' | 'UNAUTHORIZED_FAMILY_SCOPE' }
//   POST /api/auth/logout    -> 204
//   POST /api/auth/step-up   body { actionId } -> 200 { granted, expiresAtUtc }
//                             | 401 (session expired) | 403 (denied)
//
// Session model: the browser NEVER stores a bearer token in JS-reachable
// storage. All requests are made with `credentials: 'include'` so the
// backend is expected to set/clear an HttpOnly, Secure, SameSite=Strict
// session cookie on login/logout -- this client only ever reads the JSON
// body the backend returns, never a token. The `password` argument to
// signIn() is placed only in the fetch request body for the single login
// call and is never written to any variable outside that call's stack
// frame, never logged, and never persisted (no localStorage/sessionStorage
// / secureStorage use for credentials at all -- see
// ../../security/secureStorage.ts, which is reserved for browser-endpoint
// key material, not passwords).

import type { AuthenticatedSession, ServiceAuthClient } from '../interfaces';

export type ServiceAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'UNAUTHORIZED_FAMILY_SCOPE'
  | 'SESSION_EXPIRED'
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

interface DisabledAccountBody {
  code?: string;
  message?: string;
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
  return new ServiceAuthError('NETWORK_ERROR', `Could not reach the PCA auth service: ${message}`);
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
      response = await fetch(this.url('/api/auth/session'), {
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
    const session = await parseJsonSafe<AuthenticatedSession>(response);
    return session;
  }

  async signIn(email: string, password: string): Promise<AuthenticatedSession> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/auth/login'), {
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

    if (response.status === 401) {
      throw new ServiceAuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (response.status === 403) {
      const body = await parseJsonSafe<DisabledAccountBody>(response);
      if (body?.code === 'UNAUTHORIZED_FAMILY_SCOPE') {
        throw new ServiceAuthError(
          'UNAUTHORIZED_FAMILY_SCOPE',
          body.message ?? 'This account is not authorized for the requested family scope.',
        );
      }
      throw new ServiceAuthError('ACCOUNT_DISABLED', body?.message ?? 'This account has been disabled.');
    }
    if (!response.ok) {
      throw new ServiceAuthError('UNKNOWN', `Unexpected sign-in status ${response.status}`);
    }

    const session = await parseJsonSafe<AuthenticatedSession>(response);
    if (!session) {
      throw new ServiceAuthError('UNKNOWN', 'Sign-in succeeded but the session response was empty.');
    }
    return session;
  }

  async signOut(): Promise<void> {
    try {
      await fetch(this.url('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      // Sign-out is best-effort from the client's perspective -- surface a
      // typed error but never leave stale client state pretending we're
      // still authenticated; callers should still clear local UI state.
      throw networkError(err);
    }
  }

  async stepUp(actionId: string): Promise<{ granted: boolean; expiresAtUtc: string }> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/auth/step-up'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ actionId }),
      });
    } catch (err) {
      throw networkError(err);
    }

    if (response.status === 401) {
      throw new ServiceAuthError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    if (response.status === 403) {
      return { granted: false, expiresAtUtc: new Date().toISOString() };
    }
    if (!response.ok) {
      throw new ServiceAuthError('UNKNOWN', `Unexpected step-up status ${response.status}`);
    }

    const result = await parseJsonSafe<{ granted: boolean; expiresAtUtc: string }>(response);
    if (!result) {
      throw new ServiceAuthError('UNKNOWN', 'Step-up succeeded but the response was empty.');
    }
    return result;
  }
}
