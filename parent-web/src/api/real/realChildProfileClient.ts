// Real, HTTP-backed ChildProfileClient. Same live-route posture as
// ./realDeviceEnrollmentClient.ts (whose file header explains the shared
// dual-transport contract in full -- this file does not repeat it):
//   backend/src/http/routes/childProfileRoutes.ts
// mounted behind the same requireServiceSession + CSRF double-submit
// boundary, with family authorization (CREATE_CHILD_PROFILE /
// LIST_CHILD_PROFILES) enforced BEFORE any data access. Constructed with
// `cookieSession = true` (see ../client.ts) for the browser.
//
// PRIVACY-CRITICAL: this file must NEVER add a `displayName` (or any
// readable-field) parameter to createChildProfile, must NEVER read one from
// a response, and must NEVER log a request/response body wholesale (a
// generic logger that dumps `init.body` would defeat the whole point of a
// typed input that has no such field). See ../childProfileClient.ts's
// header and docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part F/H2.
import type { ChildProfileClient, ChildProfileDto, CreateChildProfileInput } from '../childProfileClient';
import { ChildProfileError } from '../childProfileClient';

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Bearer-mode placeholder for a caller with no opaque service token. The browser uses the cookie transport instead -- see realDeviceEnrollmentClient.ts's identical helper. */
export async function noServiceBearerTokenAvailable(): Promise<string | null> {
  return null;
}

// Verbatim from backend/src/parentaccount/cookies.ts, matching every other real client.
const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const match = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(prefix.length));
  } catch {
    // A malformed client-readable cookie must never turn into an invented
    // CSRF value -- send none and let the server's double-submit check
    // fail closed with 403 (same defensive posture as every sibling client).
    return null;
  }
}

function isMutationMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export class RealChildProfileClient implements ChildProfileClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getBearerToken: () => Promise<string | null> = noServiceBearerTokenAvailable,
    private readonly cookieSession = false,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    const token = this.cookieSession ? null : await this.getBearerToken();
    if (!this.cookieSession && !token) {
      throw new ChildProfileError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service session is available to authenticate this request ` +
          '(neither an opaque bearer token nor the browser cookie transport is configured on this client). This is a genuine session gap, not a network failure.',
      );
    }
    try {
      return await fetch(this.url(path), {
        ...init,
        ...(this.cookieSession ? { credentials: 'include' as const } : {}),
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(this.cookieSession && isMutationMethod(init?.method ?? 'GET')
            ? { [CSRF_HEADER_NAME]: readBrowserCookie(CSRF_COOKIE_NAME) ?? '' }
            : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new ChildProfileError('NETWORK_ERROR', `${operation}: could not reach the PCA service: ${message}`);
    }
  }

  /** Maps a non-2xx response to the typed ChildProfileError honestly, never falling back to fixture-shaped data. */
  private async fail(operation: string, response: Response): Promise<never> {
    const status = response.status;
    if (status === 400) {
      const body = await parseJsonSafe<{ error?: string; code?: string }>(response);
      throw new ChildProfileError('INVALID_REQUEST', `${operation}: invalid request.`, 400, body?.code ?? null);
    }
    if (status === 401) {
      throw new ChildProfileError(
        'UNAUTHORIZED',
        `${operation}: your service session has expired or is invalid. Please sign in again.`,
        401,
      );
    }
    if (status === 403) {
      throw new ChildProfileError(
        'FORBIDDEN',
        `${operation}: the server denied this action for your account (insufficient family authority).`,
        403,
      );
    }
    if (status === 429) {
      throw new ChildProfileError('RATE_LIMITED', `${operation}: too many requests -- please wait and retry.`, 429);
    }
    throw new ChildProfileError('UNKNOWN', `${operation}: unexpected status ${status}.`, status);
  }

  async createChildProfile(familyId: string, input?: CreateChildProfileInput): Promise<ChildProfileDto> {
    const operation = 'createChildProfile';
    // The request body is EXACTLY { idempotencyKey } or {} -- see this
    // file's header. Never add a field here without re-reading it first.
    const body: Record<string, string> = {};
    if (input?.idempotencyKey) body.idempotencyKey = input.idempotencyKey;
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/children`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!response.ok) return this.fail(operation, response);
    const result = await parseJsonSafe<ChildProfileDto>(response);
    if (!result) throw new ChildProfileError('UNKNOWN', `${operation}: empty response body.`);
    return result;
  }

  async listChildProfiles(familyId: string): Promise<ChildProfileDto[]> {
    const operation = 'listChildProfiles';
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/children`, { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const result = await parseJsonSafe<{ items: ChildProfileDto[] }>(response);
    return result?.items ?? [];
  }
}
