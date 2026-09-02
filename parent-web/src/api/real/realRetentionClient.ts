// PCA-FR-093: real, HTTP-backed RetentionClient against
// backend/src/http/routes/retentionRoutes.ts. Genuine networking code,
// verified against that route file's actual paths/methods/bodies/status
// codes under this same worktree.
//
// SESSION MODEL: these routes sit behind
// backend/src/auth/fastifyAuthPlugin.ts's `createRequireServiceSession`,
// which accepts EITHER `Authorization: Bearer <opaque-token>` OR the
// FAMILY_SERVICE_SESSION_V1 `pca_family_session` HttpOnly cookie the
// browser already holds after sign-in -- both carry the same opaque token
// and are validated through the SAME `authService.validateSession` (that
// function's own doc comment names retentionRoutes as a consumer). For a
// non-GET request over the cookie transport the server additionally
// requires the double-submit CSRF header, so this client sends it: header
// `x-pca-csrf-token` (case-insensitive on the wire) whose value must equal
// the browser-readable `pca_family_csrf` cookie -- both names taken from
// backend/src/parentaccount/cookies.ts's CSRF_HEADER_NAME/CSRF_COOKIE_NAME,
// not guessed.
//
// So the browser DOES have a reachable session transport for this client.
// Constructed with `cookieSession = true` (see ../client.ts) it sends
// `credentials: 'include'` and, on mutations, the CSRF header -- exactly
// the pattern ./realBillingClient.ts already proves. The explicit bearer
// mode is kept for non-browser callers, and when NEITHER transport is
// configured this client still fails fast with a distinct
// SERVICE_SESSION_UNAVAILABLE error before ever calling fetch rather than
// silently omitting credentials.
//
// AUTHORITY: retentionRoutes deliberately stops at "authenticated account
// with ACTIVE family scope" and performs NO server-side role check (see
// its own `createRequireActiveFamilyScope` doc comment for the
// architectural reason). This client asserts no authority of its own and
// never infers one from a response.
import type { RetentionClient } from '../interfaces';
import type { DeleteNowResult, ExportRequestResult, RetentionDefaults, RetentionPolicySettings, RetentionPolicySubmitResult } from '../../domain/retention';

export type RetentionApiErrorCode = 'SERVICE_SESSION_UNAVAILABLE' | 'FAMILY_CONTEXT_UNAVAILABLE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_REQUEST' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UNKNOWN';

export class RetentionApiError extends Error {
  constructor(
    public readonly code: RetentionApiErrorCode,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'RetentionApiError';
  }
}

/** Bearer-mode placeholder for a caller that has no opaque service token (a non-browser integration). The browser does not use this path -- see file header's SESSION MODEL. */
export async function noServiceBearerTokenAvailable(): Promise<string | null> {
  return null;
}

/** Placeholder family-context accessor for a caller that cannot resolve one. The browser wires `cookieSessionFamilyId` instead -- see ../client.ts. */
export async function noFamilyContextAvailable(): Promise<string | null> {
  return null;
}

/**
 * Verbatim from backend/src/parentaccount/cookies.ts (CSRF_COOKIE_NAME /
 * CSRF_HEADER_NAME). Header names are case-insensitive on the wire, and
 * fastify lowercases them before the `x-pca-csrf-token` comparison in
 * fastifyAuthPlugin.ts, so the conventional capitalisation used by the
 * sibling real clients is sent here too.
 */
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
    // CSRF value. Send none and let the server's double-submit check fail
    // closed with 403.
    return null;
  }
}

function isMutationMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class RealRetentionClient implements RetentionClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getBearerToken: () => Promise<string | null> = noServiceBearerTokenAvailable,
    private readonly getFamilyId: () => Promise<string | null> = noFamilyContextAvailable,
    /** True for the browser: authenticate with the existing `pca_family_session` HttpOnly cookie instead of a bearer token -- see file header. */
    private readonly cookieSession = false,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async familyId(operation: string): Promise<string> {
    const familyId = await this.getFamilyId();
    if (!familyId) {
      throw new RetentionApiError(
        'FAMILY_CONTEXT_UNAVAILABLE',
        `${operation}: no family context is available to scope this request -- the caller is not signed in to a family session (GET /api/parent/session returned no familyId). Not a network failure.`,
      );
    }
    return familyId;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    const token = this.cookieSession ? null : await this.getBearerToken();
    if (!this.cookieSession && !token) {
      throw new RetentionApiError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service session is available to authenticate this request (neither an opaque bearer token nor the browser cookie transport is configured on this client). This is a genuine session gap, not a network failure.`,
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
      throw new RetentionApiError('NETWORK_ERROR', `${operation}: could not reach the PCA privacy-control service: ${message}`);
    }
  }

  private async fail(operation: string, response: Response): Promise<never> {
    const status = response.status;
    if (status === 400 || status === 422) {
      throw new RetentionApiError('INVALID_REQUEST', `${operation}: invalid or non-compliant request.`, status);
    }
    if (status === 401) {
      throw new RetentionApiError('UNAUTHORIZED', `${operation}: your service session has expired or is invalid. Please sign in again.`, 401);
    }
    if (status === 403) {
      throw new RetentionApiError('FORBIDDEN', `${operation}: this action is not permitted for your account right now.`, 403);
    }
    if (status === 429) {
      throw new RetentionApiError('RATE_LIMITED', `${operation}: too many requests -- please wait and retry.`, 429);
    }
    throw new RetentionApiError('UNKNOWN', `${operation}: unexpected server response (${status}).`, status);
  }

  async getDefaults(): Promise<RetentionDefaults> {
    const operation = 'getDefaults';
    const response = await this.request(operation, '/v1/retention-policy/defaults', { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<RetentionDefaults>(response);
    if (!body) throw new RetentionApiError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  async submitPolicy(policy: RetentionPolicySettings): Promise<RetentionPolicySubmitResult> {
    const operation = 'submitPolicy';
    const familyId = await this.familyId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/retention-policy`, {
      method: 'POST',
      body: JSON.stringify(policy),
    });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<RetentionPolicySubmitResult>(response);
    if (!body) throw new RetentionApiError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  async deleteNow(actionId: string): Promise<DeleteNowResult> {
    const operation = 'deleteNow';
    const familyId = await this.familyId(operation);
    // records is intentionally omitted: this client has no local index of
    // the device-held entity ids to delete (the family's activity data is
    // device-local/E2EE, never held by this backend -- see
    // retentionRoutes.ts's own doc comment); the backend accepts an empty
    // records array and honestly reports retainedCount: 0 rather than this
    // client fabricating record ids it cannot actually enumerate.
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/delete-now`, {
      method: 'POST',
      body: JSON.stringify({ actionId }),
    });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<DeleteNowResult>(response);
    if (!body) throw new RetentionApiError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  async requestExport(): Promise<ExportRequestResult> {
    const operation = 'requestExport';
    const familyId = await this.familyId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/export-requests`, { method: 'POST' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<ExportRequestResult>(response);
    if (!body) throw new RetentionApiError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }
}
