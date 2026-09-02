// Real, HTTP-backed ParentRuntimeSyncClient READ-ONLY surface, against the
// parent-facing sync-status route
// (backend/src/http/routes/parentRuntimeSyncRoutes.ts,
// `GET /v1/families/:familyId/runtime-sync/devices/:deviceId/status`).
//
// Extends UnavailableParentRuntimeSyncClient and overrides ONLY the 3
// read-only bookkeeping methods (getConnectionStatus/getLastSuccessfulSync/
// getPendingDeliveryStatus) -- mirroring RealFamilyAuthorityGateway's own
// precedent (../real/realFamilyAuthorityGateway.ts) for a partially-real
// implementation. submitCiphertextEnvelope/listQueuedForEndpoint/
// acknowledgeEnvelope remain genuinely unimplemented: they require the
// parent-sdk's E2EE envelope crypto, which stays gated on a human security
// review (see unavailableProviders.ts's own file header) and is explicitly
// out of scope here.
//
// SESSION MODEL: cookie-session-backed, identical to RealBillingClient's
// cookieSession=true mode (../real/realBillingClient.ts) -- reuses the SAME
// `pca_family_session` HttpOnly cookie, resolved through the SAME
// `/api/parent/session` projection via cookieSessionFamilyId. The new route
// is a GET-only read, so no CSRF token is required (the backend's own CSRF
// check is scoped to mutating methods -- see
// backend/src/auth/fastifyAuthPlugin.ts's createRequireServiceSession).
//
// PER-DEVICE VS. FAMILY-WIDE: getPendingDeliveryStatus(endpointId) and
// getLastSuccessfulSync(deviceId) answer a SPECIFIC device's real status.
// getConnectionStatus() and getLastSuccessfulSync() (no deviceId) have no
// single device to scope to -- see this class's own method doc comments for
// exactly what each honestly returns in that case.
import type { ConnectionStatus, ParentRuntimeSyncClient, PendingDeliveryStatus } from '../runtimeSyncClient';
import { UnavailableParentRuntimeSyncClient } from './unavailableProviders';
import { cookieSessionFamilyId } from './realBillingClient';

export type ParentRuntimeSyncApiErrorCode =
  | 'FAMILY_CONTEXT_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

/** Typed error for a failed device-status read. Never thrown by the two family-wide (no-deviceId) methods -- see their own doc comments for why those honestly degrade instead. */
export class ParentRuntimeSyncApiError extends Error {
  readonly code: ParentRuntimeSyncApiErrorCode;
  readonly httpStatus: number | null;

  constructor(code: ParentRuntimeSyncApiErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'ParentRuntimeSyncApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

type WireConnectionState = 'OFFLINE' | 'SYNC_PENDING' | 'SYNCING' | 'LIVE' | 'STALE';

interface WirePendingDelivery {
  pendingCount: number;
  oldestQueuedAtUtc: string | null;
}

interface WireDeviceSyncStatus {
  deviceId: string;
  connectionState: WireConnectionState;
  lastSuccessfulSyncAtUtc: string | null;
  pendingDelivery: WirePendingDelivery;
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class RealParentRuntimeSyncClient extends UnavailableParentRuntimeSyncClient implements ParentRuntimeSyncClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getFamilyId: () => Promise<string | null> = () => cookieSessionFamilyId(apiBaseUrl),
  ) {
    super();
  }

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async fetchDeviceStatus(operation: string, deviceId: string): Promise<WireDeviceSyncStatus> {
    const familyId = await this.getFamilyId();
    if (!familyId) {
      throw new ParentRuntimeSyncApiError(
        'FAMILY_CONTEXT_UNAVAILABLE',
        `${operation}: no family session is available to scope this request.`,
      );
    }
    let response: Response;
    try {
      response = await fetch(
        this.url(`/v1/families/${encodeURIComponent(familyId)}/runtime-sync/devices/${encodeURIComponent(deviceId)}/status`),
        { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new ParentRuntimeSyncApiError('NETWORK_ERROR', `${operation}: could not reach the PCA runtime-sync service: ${message}`);
    }
    if (!response.ok) {
      if (response.status === 401) throw new ParentRuntimeSyncApiError('UNAUTHORIZED', `${operation}: your session has expired or is invalid.`, 401);
      if (response.status === 403) throw new ParentRuntimeSyncApiError('FORBIDDEN', `${operation}: this action is not permitted for your account right now.`, 403);
      if (response.status === 404) throw new ParentRuntimeSyncApiError('NOT_FOUND', `${operation}: device not found.`, 404);
      throw new ParentRuntimeSyncApiError('UNKNOWN', `${operation}: unexpected status ${response.status}.`, response.status);
    }
    const body = await parseJsonSafe<WireDeviceSyncStatus>(response);
    if (!body) throw new ParentRuntimeSyncApiError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  /**
   * Family-wide relay reachability, not scoped to any one device -- see
   * ParentRuntimeSyncClient.getConnectionStatus's own doc comment
   * (../runtimeSyncClient.ts) for why: the parent browser holds no
   * persistent relay/device session of its own yet (that requires the same
   * not-yet-built device-session ceremony the mutating envelope methods are
   * also gated behind -- see ../../domain/trustedBrowser.ts's
   * actorDeviceSessionToken doc comment). Honestly answerable today only as
   * "can this browser reach the parent-session API at all" -- reuses the
   * SAME `/api/parent/session` probe cookieSessionFamilyId already
   * performs, never fabricating a per-device status this call has no
   * device to scope to. Never throws -- an unreachable session IS the
   * honest OFFLINE signal, not an error state.
   */
  async getConnectionStatus(): Promise<ConnectionStatus> {
    const familyId = await this.getFamilyId();
    return { state: familyId ? 'ONLINE' : 'OFFLINE', checkedAtUtc: new Date().toISOString() };
  }

  /**
   * With `deviceId`: the real per-device last-successful-sync timestamp
   * from the parent-facing status route (throws a typed
   * ParentRuntimeSyncApiError on a genuine failure -- family context
   * unavailable, network error, non-2xx -- rather than silently returning
   * null for a real problem). Without one (e.g. useReconnectSync's
   * family-wide reconnect pass, which has no single device to scope to):
   * honestly returns null rather than fabricating a family-wide aggregate
   * this backend does not compute.
   */
  async getLastSuccessfulSync(deviceId?: string): Promise<string | null> {
    if (!deviceId) return null;
    const status = await this.fetchDeviceStatus('getLastSuccessfulSync', deviceId);
    return status.lastSuccessfulSyncAtUtc;
  }

  async getPendingDeliveryStatus(endpointId: string): Promise<PendingDeliveryStatus> {
    const status = await this.fetchDeviceStatus('getPendingDeliveryStatus', endpointId);
    return {
      targetEndpointId: endpointId,
      pendingCount: status.pendingDelivery.pendingCount,
      oldestQueuedAtUtc: status.pendingDelivery.oldestQueuedAtUtc,
    };
  }
}
