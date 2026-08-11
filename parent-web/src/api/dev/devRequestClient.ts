import type { RequestClient } from '../interfaces';
import type { FamilyRequest, RequestStatus } from '../../domain/types';
import { evaluatePermission } from '../../domain/roles';
import { DEV_REQUESTS } from './fixtures';
import { getDevRole } from './devState';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
let requests: FamilyRequest[] = [...DEV_REQUESTS];

/** DEVELOPMENT_ONLY fixture implementation of RequestClient. */
export class DevRequestClient implements RequestClient {
  async listRequests(status?: RequestStatus): Promise<FamilyRequest[]> {
    await delay();
    return status ? requests.filter((r) => r.status === status) : requests;
  }

  async decide(requestId: string, decision: 'APPROVED' | 'DENIED'): Promise<{ auditEventId: string }> {
    const permission = evaluatePermission(getDevRole(), 'APPROVE_REQUEST');
    await delay();
    if (!permission.allowed) throw new Error(permission.reason);
    requests = requests.map((r) => (r.requestId === requestId ? { ...r, status: decision } : r));
    return { auditEventId: `audit-request-${Date.now()}` };
  }
}
