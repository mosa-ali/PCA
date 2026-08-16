// PCA-FR-093: real, HTTP-backed RetentionClient against
// backend/src/http/routes/retentionRoutes.ts. Genuine networking code,
// verified against that route file's actual paths/methods/bodies/status
// codes under this same worktree.
//
// SESSION MODEL: identical gap to ../real/realBillingClient.ts -- these
// routes sit behind `requireServiceSession`, which parses ONLY
// `Authorization: Bearer <opaque-token>`, and no browser-reachable flow in
// this repository slice issues one of those tokens yet (see
// realBillingClient.ts's file header for the full explanation, reused
// verbatim here rather than re-litigated). This client fails fast with a
// distinct SERVICE_SESSION_UNAVAILABLE error before ever calling fetch
// when no token accessor is wired -- the HTTP plumbing itself is genuine
// and will work end-to-end the moment a real token/familyId accessor
// exists (see ../client.ts's construction of this class).
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

/** Placeholder accessor -- see file header. Reused-by-reference identity check in ../client.ts (isPaymentProviderAvailable-style pattern) is unnecessary here since this client has no "is available" query, but the exported symbol still lets ../client.ts wire it in explicitly rather than inlining `async () => null`. */
export async function noServiceBearerTokenAvailable(): Promise<string | null> {
  return null;
}

/** No browser-reachable flow resolves the caller's own familyId against this backend yet -- see file header. */
export async function noFamilyContextAvailable(): Promise<string | null> {
  return null;
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
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async familyId(operation: string): Promise<string> {
    const familyId = await this.getFamilyId();
    if (!familyId) {
      throw new RetentionApiError(
        'FAMILY_CONTEXT_UNAVAILABLE',
        `${operation}: no family context is available to scope this request. This is a genuine backend-integration gap (no browser-reachable family-context resolution flow yet), not a network failure.`,
      );
    }
    return familyId;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getBearerToken();
    if (!token) {
      throw new RetentionApiError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service-session bearer token is available to authenticate this request. This is a genuine backend-integration gap (no browser-reachable token-issuance flow yet), not a network failure.`,
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
