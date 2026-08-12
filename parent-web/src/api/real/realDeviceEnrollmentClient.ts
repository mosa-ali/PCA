// Real, HTTP-backed DeviceEnrollmentClient. Unlike RealServiceAuthClient /
// RealParentRuntimeSyncClient (aspirational contracts with no live backend
// yet in this repository slice), the routes this client calls are genuinely
// implemented and live in this same repository slice:
//   backend/src/http/routes/invitationRoutes.ts
//   backend/src/http/routes/pairingRoutes.ts
// Both are mounted behind backend/src/auth/fastifyAuthPlugin.ts's
// requireServiceSession, which parses ONLY `Authorization: Bearer
// <opaque-token>` -- it does not accept a session cookie at all. That is a
// genuinely different session-transport model from RealServiceAuthClient's
// `credentials: 'include'` HttpOnly-cookie model.
//
// KNOWN INTEGRATION GAP (see final report / KNOWN_BACKEND_INTEGRATION_ACTION
// in ../client.ts): parent-web has no browser-reachable flow today that
// issues one of this backend's bearer tokens. AuthService.issueSession
// exists (backend/src/auth/AuthService.ts) but is invoked by a device/CLI
// bootstrap path, not by any `/api/auth/login`-shaped browser route in this
// repository slice -- backend/src/http/routes contains no auth/login route
// at all. Rather than silently omitting the Authorization header (which
// would produce a misleading generic 401 indistinguishable from "the server
// rejected a real token"), this client takes an explicit `getBearerToken`
// accessor and fails fast with a distinct SERVICE_SESSION_UNAVAILABLE error
// when no token is available, before ever calling fetch. The HTTP plumbing
// itself (paths, methods, headers, status-code mapping, body shapes) is
// genuine and verified against the routes above, and will work end-to-end
// the moment a real token accessor is wired in.
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

/** No browser-reachable session flow issues this backend's bearer token yet -- see file header. */
export async function noServiceBearerTokenAvailable(): Promise<string | null> {
  return null;
}

export class RealDeviceEnrollmentClient implements DeviceEnrollmentClient {
  constructor(
    private readonly apiBaseUrl: string,
    /** Returns the current opaque service-session bearer token, or null if none is available. */
    private readonly getBearerToken: () => Promise<string | null> = noServiceBearerTokenAvailable,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getBearerToken();
    if (!token) {
      throw new DeviceEnrollmentError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service-session bearer token is available to authenticate this request. ` +
          'This is a genuine backend-integration gap (no browser-reachable token-issuance flow yet), not a network failure.',
      );
    }
    try {
      return await fetch(this.url(path), {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
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
      throw new DeviceEnrollmentError(
        'FORBIDDEN',
        `${operation}: the server denied this action for your account (insufficient family authority).`,
        403,
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
