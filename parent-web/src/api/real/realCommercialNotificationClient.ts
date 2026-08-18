// PCA-MYKIDS-BILL-3: real, HTTP-backed CommercialNotificationClient against
// backend/src/http/routes/commercialNotificationRoutes.ts's family-facing
// routes. Same session-transport gap as ../real/realBillingClient.ts (see
// that file's header) -- genuine plumbing, fails fast with a distinct
// SERVICE_SESSION_UNAVAILABLE-shaped error before ever calling fetch when no
// bearer token/family context is available yet.
import type { CommercialNotificationClient } from '../interfaces';
import type { CommercialNotification, CommercialNotificationEventType, CommercialNotificationParamValue } from '../../domain/billing';
import { BillingApiError, noFamilyContextAvailable, noServiceBearerTokenAvailable } from './realBillingClient';

interface WireNotification {
  notificationId: string;
  eventType: CommercialNotificationEventType;
  resourceRef: string | null;
  messageKey: string;
  params: Record<string, CommercialNotificationParamValue> | null;
  createdAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
}

function toNotification(wire: WireNotification): CommercialNotification {
  return {
    notificationId: wire.notificationId,
    eventType: wire.eventType,
    resourceRef: wire.resourceRef,
    messageKey: wire.messageKey,
    params: wire.params,
    createdAtUtc: wire.createdAt,
    readAtUtc: wire.readAt,
    acknowledgedAtUtc: wire.acknowledgedAt,
  };
}

function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
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

export class RealCommercialNotificationClient implements CommercialNotificationClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getBearerToken: () => Promise<string | null> = noServiceBearerTokenAvailable,
    private readonly getFamilyId: () => Promise<string | null> = noFamilyContextAvailable,
    private readonly cookieSession = false,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  /** Checked FIRST in every public method, before familyId resolution -- see RealBillingClient's identical discipline. */
  private async ensureBearerToken(operation: string): Promise<void> {
    if (this.cookieSession) return;
    const token = await this.getBearerToken();
    if (!token) {
      throw new BillingApiError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service-session bearer token is available to authenticate this request.`,
      );
    }
  }

  private async familyId(operation: string): Promise<string> {
    await this.ensureBearerToken(operation);
    const familyId = await this.getFamilyId();
    if (!familyId) {
      throw new BillingApiError(
        'FAMILY_CONTEXT_UNAVAILABLE',
        `${operation}: no family context is available to scope this request.`,
      );
    }
    return familyId;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    const token = this.cookieSession ? null : await this.getBearerToken();
    if (!this.cookieSession && !token) {
      throw new BillingApiError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service-session bearer token is available to authenticate this request.`,
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
            ? { 'X-PCA-CSRF-Token': readBrowserCookie('pca_family_csrf') ?? '' }
            : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new BillingApiError('NETWORK_ERROR', `${operation}: could not reach the PCA notification service: ${message}`);
    }
  }

  private async fail(operation: string, response: Response): Promise<never> {
    const status = response.status;
    if (status === 400) throw new BillingApiError('INVALID_REQUEST', `${operation}: invalid request.`, 400);
    if (status === 401) throw new BillingApiError('UNAUTHORIZED', `${operation}: your service session has expired or is invalid.`, 401);
    if (status === 403) throw new BillingApiError('FORBIDDEN', `${operation}: this action is not permitted for your account.`, 403);
    if (status === 404) throw new BillingApiError('NOT_FOUND', `${operation}: not found.`, 404);
    if (status === 429) throw new BillingApiError('RATE_LIMITED', `${operation}: too many requests -- please wait and retry.`, 429);
    throw new BillingApiError('UNKNOWN', `${operation}: unexpected status ${status}.`, status);
  }

  async list(limit?: number): Promise<CommercialNotification[]> {
    const operation = 'list';
    const familyId = await this.familyId(operation);
    const query = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : '';
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/commercial-notifications${query}`, { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<{ notifications: WireNotification[] }>(response);
    return (body?.notifications ?? []).map(toNotification);
  }

  async unreadCount(): Promise<number> {
    const operation = 'unreadCount';
    const familyId = await this.familyId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/commercial-notifications/unread-count`, { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<{ unreadCount: number }>(response);
    return body?.unreadCount ?? 0;
  }

  async markRead(notificationId: string): Promise<void> {
    const operation = 'markRead';
    const familyId = await this.familyId(operation);
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/commercial-notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'POST' },
    );
    if (!response.ok) return this.fail(operation, response);
  }

  async acknowledge(notificationId: string): Promise<void> {
    const operation = 'acknowledge';
    const familyId = await this.familyId(operation);
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/commercial-notifications/${encodeURIComponent(notificationId)}/acknowledge`,
      { method: 'POST' },
    );
    if (!response.ok) return this.fail(operation, response);
  }
}
