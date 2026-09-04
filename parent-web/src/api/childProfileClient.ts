// ChildProfileClient -- the browser-side port for the opaque central
// child-profile membership registry (backend/src/http/routes/
// childProfileRoutes.ts). Mirrors the field/behaviour invariants
// backend/src/childprofiles/ChildProfileRegistryRepository.ts's own doc
// comment states, and which the owner's ruling on child-profile privacy
// makes load-bearing here specifically:
//
//  - The wire contract carries EXACTLY { childProfileId, createdAt } in
//    both directions that matter. There is no `displayName` field on this
//    interface, on CreateChildProfileInput, or on ChildProfileDto -- not
//    optional, not nullable, ABSENT. A caller cannot "forget" to omit the
//    child's name; the type does not offer anywhere to put it.
//  - childProfileId is ALWAYS server-minted. No method on this interface
//    accepts one as an input to create() -- only idempotencyKey, an
//    operational retry-safety value never treated as (or logged as, or
//    displayed as) child-profile content.
//  - The child's READABLE display name never crosses this port in either
//    direction. It is collected and rendered entirely from the trusted
//    parent context's own session-local label store
//    (../domain/childLabels.ts), never sent here and never returned here.
//    See docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part F/H2.

export interface ChildProfileDto {
  childProfileId: string;
  createdAt: string;
}

export interface CreateChildProfileInput {
  /** Optional retry-safety value. Never child-profile content -- see file header. */
  idempotencyKey?: string;
}

export type ChildProfileErrorCode =
  | 'INVALID_REQUEST' // 400
  | 'UNAUTHORIZED' // 401 -- expired/missing service session
  | 'FORBIDDEN' // 403 -- real RBAC rejection from AuthzService, not a client guess
  | 'RATE_LIMITED' // 429
  | 'NETWORK_ERROR' // fetch threw / offline
  | 'SERVICE_SESSION_UNAVAILABLE' // no bearer token available to attach -- see realChildProfileClient.ts
  | 'UNKNOWN';

export class ChildProfileError extends Error {
  readonly code: ChildProfileErrorCode;
  readonly httpStatus: number | null;
  /** The backend's own machine-readable `code` field (e.g. READABLE_CHILD_FIELD_NOT_ALLOWED), when present -- see realChildProfileClient.ts's fail(). */
  readonly serverCode: string | null;

  constructor(code: ChildProfileErrorCode, message: string, httpStatus: number | null = null, serverCode: string | null = null) {
    super(message);
    this.name = 'ChildProfileError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.serverCode = serverCode;
  }
}

export interface ChildProfileClient {
  /** Mints a new opaque child-profile entry. Returns ONLY the opaque id and its creation time -- see file header. */
  createChildProfile(familyId: string, input?: CreateChildProfileInput): Promise<ChildProfileDto>;
  /** Every opaque entry belonging to familyId. No cross-family read exists on this interface at all. */
  listChildProfiles(familyId: string): Promise<ChildProfileDto[]>;
}
