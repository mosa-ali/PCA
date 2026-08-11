import type { ChildRequest, ChildRequestId } from './types.js';

/** Local/E2EE persistence port -- never a central readable store of child request content (lane brief Section 14). Only an in-memory reference implementation exists here. */
export interface ChildRequestRepository {
  get(requestId: ChildRequestId): Promise<ChildRequest | null>;
  put(request: ChildRequest): Promise<void>;
  listForFamily(familyId: string): Promise<ChildRequest[]>;
}

export class InMemoryChildRequestRepository implements ChildRequestRepository {
  private readonly requests = new Map<ChildRequestId, ChildRequest>();

  async get(requestId: ChildRequestId): Promise<ChildRequest | null> {
    return this.requests.get(requestId) ?? null;
  }

  async put(request: ChildRequest): Promise<void> {
    this.requests.set(request.requestId, request);
  }

  async listForFamily(familyId: string): Promise<ChildRequest[]> {
    return [...this.requests.values()].filter((r) => r.familyId === familyId);
  }
}
