// Real (non-fixture) RequestClient. Same crypto-gated pattern as
// RealParentFamilyDataGateway -- see that file's header comment. Family
// requests (bonus-time, unblock, etc.) contain child-identifying reason
// text and are therefore treated as family content requiring decryption,
// not server-visible metadata.
//
// decide()/grantBonusTime() call the real, wired backend
// (backend/src/http/routes/childRequestRoutes.ts) using the SAME
// actor-identity-binding pattern RealSafeZoneClient already established:
// the HttpOnly family session cookie for family/account identity, a
// double-submit CSRF header for the mutation, and an
// `Authorization: Bearer <actorDeviceSessionToken>` header (sourced from
// TrustedBrowserProvider.getSnapshot(), never a self-asserted id) for the
// acting device's identity. Production currently wires
// UnavailableTrustSetRoleResolver under the shared
// ParentActionAuthorizationService (see childRequestRoutes.ts's own header
// comment), so even a fully-authenticated real call fails closed with a
// 403 NOT_AUTHORIZED_TO_DECIDE today -- an honest, by-design external gate,
// not a reason to leave this client throwing a hardcoded stub error before
// the request is ever sent.
import type { FamilyRequest, RequestStatus } from '../../domain/types';
import type { RequestClient } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { localFamilyDataStore, type LocalFamilyDataStore } from '../../security/localFamilyDataStore';
import { requireTrustedAndCryptoReady } from './familyDataGate';
import { cookieSessionFamilyId } from './realBillingClient';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

interface WireChildRequest {
  requestId?: unknown;
  decisionActionId?: unknown;
}

export class RealRequestClient implements RequestClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trustedBrowser: TrustedBrowserProvider,
    private readonly store: LocalFamilyDataStore = localFamilyDataStore,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async listRequests(status?: RequestStatus): Promise<FamilyRequest[]> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'RequestClient.listRequests');
    const record = this.store.get<FamilyRequest[]>('familyRequests');
    const all = record?.data ?? [];
    return status ? all.filter((r) => r.status === status) : all;
  }

  async decide(requestId: string, decision: 'APPROVED' | 'DENIED' | 'COUNTERED', counterOfferExtraMinutes?: number): Promise<{ auditEventId: string }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'RequestClient.decide');
    const actorHeaders = await this.actorHeaders();
    const familyId = await this.familyId('RequestClient.decide');
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/child-requests/${encodeURIComponent(requestId)}/decide`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...actorHeaders,
        ...this.csrfHeader(),
      },
      body: JSON.stringify(decision === 'COUNTERED' ? { decision, counterOfferExtraMinutes } : { decision }),
    });
    if (!response.ok) throw new Error(await this.errorMessage('RequestClient.decide', response));
    const body = (await this.json(response)) as { request?: WireChildRequest };
    return { auditEventId: typeof body.request?.decisionActionId === 'string' ? body.request.decisionActionId : '' };
  }

  /** PCA-FR-130 "grant directly" -- same not-implemented-yet posture as decide() above; see this file's header comment. */
  async grantBonusTime(childId: string, extraMinutes: number, reasonText?: string | null): Promise<{ auditEventId: string; requestId: string }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'RequestClient.grantBonusTime');
    const actorHeaders = await this.actorHeaders();
    const familyId = await this.familyId('RequestClient.grantBonusTime');
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/bonus-time/grant`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...actorHeaders,
        ...this.csrfHeader(),
      },
      body: JSON.stringify({ childProfileId: childId, extraMinutes, ...(reasonText ? { reasonNote: reasonText } : {}) }),
    });
    if (!response.ok) throw new Error(await this.errorMessage('RequestClient.grantBonusTime', response));
    const body = (await this.json(response)) as { request?: WireChildRequest };
    return {
      auditEventId: typeof body.request?.decisionActionId === 'string' ? body.request.decisionActionId : '',
      requestId: typeof body.request?.requestId === 'string' ? body.request.requestId : '',
    };
  }

  private async familyId(operation: string): Promise<string> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) throw new Error(`${operation}: no family session is available to scope this request.`);
    return familyId;
  }

  private csrfHeader(): Record<string, string> {
    const csrf = readCsrfCookie();
    return csrf ? { [CSRF_HEADER_NAME]: csrf } : {};
  }

  /**
   * SECURITY (actor-identity binding): mirrors RealSafeZoneClient's
   * actorHeaders() exactly -- see that file's doc comment for the full
   * rationale. Sends the server a verified, session-bound device identity
   * (`actorDeviceSessionToken` as `Authorization: Bearer <token>`), never a
   * self-reported id.
   */
  private async actorHeaders(): Promise<Record<string, string>> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED') throw new Error('TRUSTED_BROWSER_REQUIRED');
    if (!snapshot.actorDeviceSessionToken) throw new Error('ACTOR_DEVICE_SESSION_UNAVAILABLE');
    return { Authorization: `Bearer ${snapshot.actorDeviceSessionToken}` };
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new Error('REQUEST_RESPONSE_INVALID');
    }
  }

  private async errorMessage(operation: string, response: Response): Promise<string> {
    const body = await this.json(response).catch(() => null);
    const code = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    return `${operation}: request failed (${response.status}${code ? `: ${code}` : ''}).`;
  }
}
