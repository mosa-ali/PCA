// Real (non-fixture) RequestClient. Same crypto-gated pattern as
// RealParentFamilyDataGateway -- see that file's header comment. Family
// requests (bonus-time, unblock, etc.) contain child-identifying reason
// text and are therefore treated as family content requiring decryption,
// not server-visible metadata.
//
// decide()/grantBonusTime() use the Parent's HttpOnly family session cookie,
// family-scoped role check, and double-submit CSRF header. These are Parent
// account actions; they do not impersonate a device actor or require browser
// device enrollment. Child submission and applied acknowledgements remain
// device-session-bound in the backend's child-facing routes.
import type { FamilyRequest, RequestStatus } from '../../domain/types';
import type { RequestClient } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { localFamilyDataStore, type LocalFamilyDataStore } from '../../security/localFamilyDataStore';
import { requireFamilyCryptoReady } from './familyDataGate';
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
    _trustedBrowser: TrustedBrowserProvider,
    private readonly store: LocalFamilyDataStore = localFamilyDataStore,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async listRequests(status?: RequestStatus): Promise<FamilyRequest[]> {
    await requireFamilyCryptoReady('RequestClient.listRequests');
    const record = this.store.get<FamilyRequest[]>('familyRequests');
    const all = record?.data ?? [];
    return status ? all.filter((r) => r.status === status) : all;
  }

  async decide(requestId: string, decision: 'APPROVED' | 'DENIED' | 'COUNTERED', counterOfferExtraMinutes?: number): Promise<{ auditEventId: string }> {
    await requireFamilyCryptoReady('RequestClient.decide');
    const familyId = await this.familyId('RequestClient.decide');
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/child-requests/${encodeURIComponent(requestId)}/decide`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.csrfHeader(),
      },
      body: JSON.stringify(decision === 'COUNTERED' ? { decision, counterOfferExtraMinutes } : { decision }),
    });
    if (!response.ok) throw new Error(await this.errorMessage('RequestClient.decide', response));
    const body = (await this.json(response)) as { request?: WireChildRequest };
    return { auditEventId: typeof body.request?.decisionActionId === 'string' ? body.request.decisionActionId : '' };
  }

  /** PCA-FR-130 direct grant, authorized by the signed-in Parent session. */
  async grantBonusTime(childId: string, extraMinutes: number, reasonText?: string | null): Promise<{ auditEventId: string; requestId: string }> {
    await requireFamilyCryptoReady('RequestClient.grantBonusTime');
    const familyId = await this.familyId('RequestClient.grantBonusTime');
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/bonus-time/grant`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
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
