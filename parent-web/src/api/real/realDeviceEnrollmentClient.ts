// Real, HTTP-backed DeviceEnrollmentClient. Unlike RealServiceAuthClient
// (an aspirational contract with no live backend yet in this repository
// slice), the routes this client calls are genuinely implemented and live
// in this same repository slice:
//   backend/src/http/routes/invitationRoutes.ts
//   backend/src/http/routes/pairingRoutes.ts
// Both are mounted behind backend/src/auth/fastifyAuthPlugin.ts's
// requireServiceSession, which accepts EITHER `Authorization: Bearer
// <opaque-token>` OR the FAMILY_SERVICE_SESSION_V1 `pca_family_session`
// HttpOnly cookie the browser already holds after sign-in -- both carry the
// same opaque token and are validated through the SAME
// `authService.validateSession` (see that function's own doc comment, which
// names invitationRoutes/pairingRoutes as consumers). Non-GET requests over
// the cookie transport additionally require the double-submit CSRF header
// `x-pca-csrf-token`, whose value must equal the browser-readable
// `pca_family_csrf` cookie -- both names taken verbatim from
// backend/src/parentaccount/cookies.ts, not guessed.
//
// So the browser DOES have a reachable session transport for these routes.
// Constructed with `cookieSession = true` (see ../client.ts) this client
// sends `credentials: 'include'` and, on mutations, the CSRF header --
// exactly the pattern ./realBillingClient.ts already proves. The explicit
// bearer mode is kept for non-browser callers, and when NEITHER transport
// is configured this client still fails fast with a distinct
// SERVICE_SESSION_UNAVAILABLE error before ever calling fetch rather than
// silently omitting credentials.
//
// AUTHORITY: invitationRoutes independently requires family authorization
// behind this auth boundary, so a caller whose session is valid but whose
// family authority is not can now receive an honest server-issued 403
// (mapped to DeviceEnrollmentError('FORBIDDEN'), with the body's own `code`
// forwarded) instead of a client-side excuse the server never gave.
import type {
  CreateInvitationInput,
  DeviceEnrollmentClient,
  InvitationCreatedDto,
  InvitationDto,
  PairingRequestDto,
} from '../deviceEnrollmentClient';
import { DeviceEnrollmentError } from '../deviceEnrollmentClient';

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Bearer-mode placeholder for a caller that has no opaque service token (a non-browser integration). The browser uses the cookie transport instead -- see file header. */
export async function noServiceBearerTokenAvailable(): Promise<string | null> {
  return null;
}

/**
 * Verbatim from backend/src/parentaccount/cookies.ts (CSRF_COOKIE_NAME /
 * CSRF_HEADER_NAME). Header names are case-insensitive on the wire and
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

export class RealDeviceEnrollmentClient implements DeviceEnrollmentClient {
  constructor(
    private readonly apiBaseUrl: string,
    /** Returns the current opaque service-session bearer token, or null if none is available. Never consulted in cookie-session mode. */
    private readonly getBearerToken: () => Promise<string | null> = noServiceBearerTokenAvailable,
    /** True for the browser: authenticate with the existing `pca_family_session` HttpOnly cookie instead of a bearer token -- see file header. */
    private readonly cookieSession = false,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    const token = this.cookieSession ? null : await this.getBearerToken();
    if (!this.cookieSession && !token) {
      throw new DeviceEnrollmentError(
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
      throw new DeviceEnrollmentError('NETWORK_ERROR', `${operation}: could not reach the PCA service: ${message}`);
    }
  }

  /** Maps a non-2xx response to the typed DeviceEnrollmentError honestly, never falling back to fixture-shaped data. */
  private async fail(operation: string, response: Response): Promise<never> {
    const status = response.status;
    if (status === 400) throw new DeviceEnrollmentError('INVALID_REQUEST', `${operation}: invalid request.`, 400);
    if (status === 401) {
      throw new DeviceEnrollmentError(
        'UNAUTHORIZED',
        `${operation}: your service session has expired or is invalid. Please sign in again.`,
        401,
      );
    }
    if (status === 403) {
      // invitationRoutes.ts sends { error: 'forbidden', code } for the
      // specific, actionable RBAC/entitlement reasons (e.g.
      // MANAGED_DEVICE_LIMIT_REACHED) -- forward that code so callers can
      // distinguish it from a generic authority rejection instead of only
      // ever seeing "insufficient family authority".
      const body = await parseJsonSafe<{ error?: string; code?: string }>(response);
      throw new DeviceEnrollmentError(
        'FORBIDDEN',
        `${operation}: the server denied this action for your account (insufficient family authority).`,
        403,
        body?.code ?? null,
      );
    }
    if (status === 404) {
      throw new DeviceEnrollmentError('NOT_FOUND', `${operation}: not found.`, 404);
    }
    if (status === 409) {
      throw new DeviceEnrollmentError(
        'CONFLICT',
        `${operation}: this request conflicts with the current state (e.g. already paired or revoked).`,
        409,
      );
    }
    if (status === 429) {
      throw new DeviceEnrollmentError('RATE_LIMITED', `${operation}: too many requests -- please wait and retry.`, 429);
    }
    throw new DeviceEnrollmentError('UNKNOWN', `${operation}: unexpected status ${status}.`, status);
  }

  async createInvitation(familyId: string, input: CreateInvitationInput): Promise<InvitationCreatedDto> {
    const operation = 'createInvitation';
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/invitations`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<InvitationCreatedDto>(response);
    if (!body) throw new DeviceEnrollmentError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  async getInvitation(familyId: string, invitationId: string): Promise<InvitationDto> {
    const operation = 'getInvitation';
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'GET' },
    );
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<InvitationDto>(response);
    if (!body) throw new DeviceEnrollmentError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  async listInvitations(familyId: string): Promise<InvitationDto[]> {
    const operation = 'listInvitations';
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/invitations`,
      { method: 'GET' },
    );
    if (!response.ok) return this.fail(operation, response);
    return (await parseJsonSafe<InvitationDto[]>(response)) ?? [];
  }

  async revokeInvitation(familyId: string, invitationId: string): Promise<InvitationDto> {
    const operation = 'revokeInvitation';
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: 'POST' },
    );
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<InvitationDto>(response);
    if (!body) throw new DeviceEnrollmentError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  async getPairingRequest(familyId: string, deviceId: string): Promise<PairingRequestDto> {
    const operation = 'getPairingRequest';
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/pairing-requests/${encodeURIComponent(deviceId)}`,
      { method: 'GET' },
    );
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<PairingRequestDto>(response);
    if (!body) throw new DeviceEnrollmentError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  /** Resolves to PAIRED only (idempotent) -- never ACTIVE. See file header and PairingService doc comment. */
  async confirmPairing(familyId: string, deviceId: string): Promise<PairingRequestDto> {
    const operation = 'confirmPairing';
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/pairing-requests/${encodeURIComponent(deviceId)}/confirm`,
      { method: 'POST' },
    );
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<PairingRequestDto>(response);
    if (!body) throw new DeviceEnrollmentError('UNKNOWN', `${operation}: empty response body.`);
    if (body.status === 'ACTIVE') {
      // Defense in depth: this must never happen per the verified backend
      // contract, but never let a client-side rendering bug propagate a
      // false "ACTIVE" claim if the contract is ever violated upstream.
      throw new DeviceEnrollmentError(
        'UNKNOWN',
        `${operation}: server returned unexpected status ACTIVE (pairing confirmation must only reach PAIRED).`,
      );
    }
    return body;
  }
}
