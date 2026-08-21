import type { RequestClient } from '../interfaces';
import type { FamilyRequest, RequestStatus } from '../../domain/types';
import { evaluatePermission } from '../../domain/roles';
import { validateBonusMinutes, validateCounterOffer } from '../../domain/bonusTime';
import { DEV_CHILDREN, DEV_REQUESTS } from './fixtures';
import { getDevRole } from './devState';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
let requests: FamilyRequest[] = [...DEV_REQUESTS];
let nextRequestId = requests.length + 1;

/** Test-only reset hook -- same convention as devBillingClient.ts's __resetDevBillingStateForTests. Restores the module-level fixture copy so each test file's `it()` blocks don't leak decided/granted state into one another. */
export function __resetDevRequestsForTests(): void {
  requests = [...DEV_REQUESTS];
  nextRequestId = requests.length + 1;
}

/** DEVELOPMENT_ONLY fixture implementation of RequestClient. */
export class DevRequestClient implements RequestClient {
  async listRequests(status?: RequestStatus): Promise<FamilyRequest[]> {
    await delay();
    return status ? requests.filter((r) => r.status === status) : requests;
  }

  /**
   * PCA-FR-130: approve/deny a pending request, or counter-offer a SHORTER
   * duration for a BONUS_TIME request. Mirrors
   * `backend/src/childrequests/ChildRequestService.decide()`'s own
   * validation order (role check, then bound/shorter-than check) so a Dev
   * Mode UI author sees the same rejections a real backend would produce.
   */
  async decide(requestId: string, decision: 'APPROVED' | 'DENIED' | 'COUNTERED', counterOfferExtraMinutes?: number): Promise<{ auditEventId: string }> {
    const permission = evaluatePermission(getDevRole(), 'APPROVE_REQUEST');
    await delay();
    if (!permission.allowed) throw new Error(permission.reason);

    const target = requests.find((r) => r.requestId === requestId);
    if (!target) throw new Error('Request not found.');

    let grantedExtraMinutes = target.grantedExtraMinutes ?? null;
    if (decision === 'COUNTERED') {
      if (target.type !== 'BONUS_TIME' || target.requestedExtraMinutes == null) {
        throw new Error('Only a BONUS_TIME request can be countered.');
      }
      if (counterOfferExtraMinutes === undefined) throw new Error('A counter-offer amount is required.');
      const error = validateCounterOffer(counterOfferExtraMinutes, target.requestedExtraMinutes);
      if (error) throw new Error(`Counter-offer invalid: ${error}`);
      grantedExtraMinutes = counterOfferExtraMinutes;
    } else if (decision === 'APPROVED' && target.type === 'BONUS_TIME' && target.requestedExtraMinutes != null) {
      grantedExtraMinutes = target.requestedExtraMinutes;
    }

    requests = requests.map((r) => (r.requestId === requestId ? { ...r, status: decision, grantedExtraMinutes } : r));
    return { auditEventId: `audit-request-${Date.now()}` };
  }

  /** PCA-FR-130 "grant directly" -- creates an already-APPROVED BONUS_TIME request, exactly as if the same parent had both authored and immediately approved a child's own ask (see backend's `grantDirectly`, the same composition this mirrors). */
  async grantBonusTime(childId: string, extraMinutes: number, reasonText?: string | null): Promise<{ auditEventId: string; requestId: string }> {
    const permission = evaluatePermission(getDevRole(), 'APPROVE_REQUEST');
    await delay();
    if (!permission.allowed) throw new Error(permission.reason);

    const error = validateBonusMinutes(extraMinutes);
    if (error) throw new Error(`Bonus minutes invalid: ${error}`);

    const child = DEV_CHILDREN.find((c) => c.childId === childId);
    const requestId = `req-direct-${nextRequestId++}`;
    const request: FamilyRequest = {
      requestId,
      childId,
      childDisplayName: child?.displayName ?? childId,
      type: 'BONUS_TIME',
      reasonText: reasonText ?? null,
      createdAtUtc: new Date().toISOString(),
      status: 'APPROVED',
      correlationId: `corr-direct-${requestId}`,
      requestedExtraMinutes: extraMinutes,
      grantedExtraMinutes: extraMinutes,
    };
    requests = [request, ...requests];
    return { auditEventId: `audit-grant-${Date.now()}`, requestId };
  }
}
