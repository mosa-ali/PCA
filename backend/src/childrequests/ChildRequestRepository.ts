import type { ChildRequest, ChildRequestId } from './types.js';

/**
 * Local/E2EE persistence port -- never a central readable store of child request content (lane brief
 * Section 14).
 *
 * WHAT IS ACTUALLY TRUE TODAY, stated plainly because the line above is a
 * DESIGN TARGET and was previously read as a description of the running system
 * (it is not): the only implementation is `InMemoryChildRequestRepository`, and
 * `ChildRequest` carries real family content -- `reasonNote` (child-authored
 * free text), `requestedAppScope`, `installTargetPackageName` and
 * `installTargetAppLabel` (which app, by name). `childRequestRoutes.ts`'s
 * `toRequestDto` serialises EVERY one of those fields, and
 * `GET /api/parent/families/:familyId/child-requests` returns them as plaintext
 * JSON on a family session, from a store held in process memory and wired into
 * the production composition root. So the running server does hold and serve
 * this content in the clear; it is not E2EE in transit to the browser, and it is
 * readable by anything that can read server memory.
 *
 * That is a genuine open architecture decision, recorded as PCA-DEC-028, NOT a
 * settled property and NOT something this module may quietly presuppose either
 * way. Two consequences bind any change made here:
 *   * Durability must NOT be added as a plaintext central table. P1-04 lists
 *     this store as durable-required because restart loss is real (the parent's
 *     list silently becomes empty, which reads as "no requests" rather than as
 *     unavailable), but "make it durable" is NOT a licence to persist
 *     `reasonNote`/app identity server-side. The E2EE-consistent shape is the
 *     one familyrbac already built for audit events and alerts: an opaque,
 *     crypto-bound envelope with the authoritative record on the family's own
 *     devices.
 *   * If the intended posture really is E2EE-only (doc 18's model, which this
 *     module's own comments cite), then the plaintext parent-web DTO is the
 *     thing that must change, not merely the storage.
 */
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
