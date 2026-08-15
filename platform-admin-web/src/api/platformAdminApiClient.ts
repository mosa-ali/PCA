// Generic authenticated HTTP client for every Platform Administration data
// route beyond the five auth endpoints (see platformAdminAuthClient.ts for
// those). Every call attaches the in-memory Platform Admin session bearer
// token (never a parent/family token -- this app only ever holds the
// operator session, PCA-ADD-PA-001) and normalizes non-2xx responses into
// PlatformAdminApiError so every page can handle 401/403/404/409/400
// uniformly instead of re-parsing bodies ad hoc.
import { config } from '../config/env';
import { secureSession } from '../security/secureSession';
import { PlatformAdminApiError } from './platformAdminAuthClient';

export { PlatformAdminApiError };

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // fall through
  }
  return response.status >= 500 ? 'server_error' : 'unknown_error';
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const session = secureSession.get();
  if (!session) throw new PlatformAdminApiError(401, 'unauthorized');
  return { Authorization: `Bearer ${session.token}`, ...extra };
}

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${config.apiBaseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export const platformAdminApi = {
  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const response = await fetch(buildUrl(path, query), { headers: authHeaders() });
    if (!response.ok) throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
    return (await response.json()) as T;
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(buildUrl(path), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  },

  async put<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(buildUrl(path), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new PlatformAdminApiError(response.status, await parseErrorBody(response));
    return (await response.json()) as T;
  },
};

/** True for a 403 forbidden response -- used to render a graceful "not authorized by server" state rather than crashing, since the client-side RBAC hint can never be fully trusted (mission Section 8). */
export function isForbiddenError(error: unknown): error is PlatformAdminApiError {
  return error instanceof PlatformAdminApiError && error.status === 403;
}

export function isNotFoundError(error: unknown): error is PlatformAdminApiError {
  return error instanceof PlatformAdminApiError && error.status === 404;
}
