import { config } from '../config/env';
import type { PlatformAdminRole } from '../domain/roles';
import type { PlatformAdminStepUpScope } from '../domain/stepUpScopes';
import { secureSession } from '../security/secureSession';

/** Thrown for every non-2xx response. Never carries error.message from the server body beyond the small closed `code` set the backend actually returns (unauthorized/forbidden/invalid_request) -- see backend/src/http/routes/platformAdminAuthRoutes.ts, which itself never leaks internal error detail on a 5xx. */
export class PlatformAdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'PlatformAdminApiError';
  }
}

export interface LoginResult {
  sessionToken: string;
  expiresAt: string;
}

export interface WhoAmI {
  adminId: string;
  roles: PlatformAdminRole[];
  sessionExpiresAt: string | undefined;
}

export interface StepUpResult {
  stepUpId: string;
  expiresAt: string;
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // fall through to a generic code below
  }
  return response.status >= 500 ? 'server_error' : 'unknown_error';
}

/**
 * Real HTTP client for the five Platform Administration auth endpoints
 * that actually exist server-side (backend/src/http/routes/platformAdminAuthRoutes.ts).
 * No other Platform Administration HTTP endpoint exists in this backend
 * slice as of this app's authoring -- see the app's README for the full
 * BACKEND_GAP_REQUIRED inventory. This client never fabricates a response
 * for an endpoint the backend doesn't serve.
 */
export const platformAdminAuthClient = {
  async login(email: string, password: string, totpCode: string): Promise<LoginResult> {
    const response = await fetch(`${config.apiBaseUrl}/platform-admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, totpCode }),
    });
    if (!response.ok) throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
    return (await response.json()) as LoginResult;
  },

  async logout(): Promise<void> {
    const session = secureSession.get();
    if (!session) return;
    const response = await fetch(`${config.apiBaseUrl}/platform-admin/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok && response.status !== 401) {
      throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
    }
  },

  async revokeAllSessions(): Promise<void> {
    const session = secureSession.get();
    if (!session) throw new PlatformAdminApiError(401, 'unauthorized');
    const response = await fetch(`${config.apiBaseUrl}/platform-admin/auth/sessions/revoke-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
  },

  async stepUp(scope: PlatformAdminStepUpScope, totpCode: string): Promise<StepUpResult> {
    const session = secureSession.get();
    if (!session) throw new PlatformAdminApiError(401, 'unauthorized');
    const response = await fetch(`${config.apiBaseUrl}/platform-admin/auth/step-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ scope, totpCode }),
    });
    if (!response.ok) throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
    return (await response.json()) as StepUpResult;
  },

  async whoami(): Promise<WhoAmI> {
    const session = secureSession.get();
    if (!session) throw new PlatformAdminApiError(401, 'unauthorized');
    const response = await fetch(`${config.apiBaseUrl}/platform-admin/auth/whoami`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
    return (await response.json()) as WhoAmI;
  },
};
