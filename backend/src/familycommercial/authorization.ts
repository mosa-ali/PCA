/**
 * PCA-MYKIDS-BILL-2 -- family-commercial HTTP authorization.
 *
 * WHY THIS FILE EXISTS INSTEAD OF REUSING `createRequireFamilyAuthorization`
 * (http/requireFamilyAuthorization.ts): that helper is bound to the CLOSED
 * `ServiceOperation` union (authz/types.ts) and its matching closed
 * `OPERATION_MATRIX` (authz/policy.ts) -- both files are explicitly outside
 * this lane's ownership boundary (they belong to PCA-PA-1/the invitation
 * lane) and this mission's own instructions forbid editing another agent's
 * owned files. Adding new `ServiceOperation` members for entitlement/
 * request/subscription/invoice/payment-method reads and the two increase-
 * request mutations would require exactly that edit.
 *
 * Rather than either (a) misusing an existing, semantically-unrelated
 * `ServiceOperation` member just because its requirement SHAPE happens to
 * match, or (b) building a parallel, duplicate scope-storage mechanism, this
 * module defines its own small, closed operation vocabulary and
 * `requirements` matrix -- structurally identical in spirit to
 * `authz/policy.ts`'s own "explicit, closed classification, no
 * default/fallback case" discipline -- but evaluated directly against the
 * SAME underlying `AuthzRepository` port (authz/AuthzRepository.ts) every
 * other family-scoped route already reads from. No new scope table, no new
 * license table: this is purely a same-primitive, different-entry-point
 * authorization layer, scoped to this lane's own routes only.
 *
 * OWNER-GATED MUTATIONS: every family-commercial MUTATION (device-limit
 * increase request, cancel request, cancel auto-renew) additionally
 * requires `FamilyCommercialAuthorityResolver.resolveOwnerAuthority` to
 * return OWNER_AUTHORIZED -- resolved by the route handler itself (not this
 * preHandler), mirroring billingCheckoutRoutes.ts's own FIX 4 pattern
 * exactly, including its distinct ROLE_DENIED vs AUTHORITY_UNAVAILABLE
 * handling (never silently treating "unavailable" as "is Owner").
 * PARENT_MEMBER_LIMIT requests are also Owner-gated (a family-authority
 * decision, not a billing one -- PCA-ADD-PA-054 leaves the increase
 * non-billable, but who may REQUEST it is still governed by family
 * commercial authority, same as a device-limit request).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthzRepository } from '../authz/AuthzRepository.js';
import type { FamilyCommercialAuthorityResolver, FamilyCommercialAuthorityResult } from '../billing/authority/FamilyCommercialAuthorityResolver.js';

const MAX_FAMILY_ID_LENGTH = 128;
const MAX_ACTOR_DEVICE_ID_LENGTH = 128;

export type FamilyCommercialOperation =
  /** Entitlement snapshot + request list/detail reads. */
  | 'VIEW_ENTITLEMENT'
  /**
   * Create (device-limit OR parent-member-limit) / cancel an increase
   * request -- both limit types share ONE route
   * (`POST /commercial/requests`, matching Agent46's own single
   * `requestLimitIncrease(limitType, targetLimit)` client method), so
   * license-gating cannot be a per-route preHandler distinction here. This
   * operation itself never requires a license; the route handler performs
   * an EXTRA, targeted `hasActiveLicense` check via the same
   * `AuthzRepository` ONLY when `limitType === 'MANAGED_DEVICE_LIMIT'`
   * (the billable path) before calling the service -- see
   * familyCommercialRoutes.ts.
   */
  | 'MUTATE_REQUESTS'
  /** Subscription + invoice + payment-method reads. */
  | 'VIEW_BILLING_RECORDS';

export interface FamilyCommercialOperationRequirements {
  /** Every operation in this module requires an ACTIVE family scope -- there is no family-commercial read/write that a caller with no scope for the target family may ever reach. */
  readonly requiresFamilyScope: true;
  readonly requiresLicense: boolean;
}

const OPERATION_MATRIX: Record<FamilyCommercialOperation, FamilyCommercialOperationRequirements> = {
  VIEW_ENTITLEMENT: { requiresFamilyScope: true, requiresLicense: false },
  MUTATE_REQUESTS: { requiresFamilyScope: true, requiresLicense: false },
  VIEW_BILLING_RECORDS: { requiresFamilyScope: true, requiresLicense: false },
};

export function resolveFamilyCommercialRequirements(operation: FamilyCommercialOperation): FamilyCommercialOperationRequirements {
  const requirements = OPERATION_MATRIX[operation];
  if (!requirements) throw new Error(`No family-commercial authorization requirements registered for operation: ${operation}`);
  return requirements;
}

/**
 * Fastify preHandler: must run AFTER a service-session preHandler (so
 * `request.accountId` is already set) and BEFORE the route handler. Proves
 * only "this service account holds an ACTIVE family-scope row for this
 * family [+ an active license, for billable operations]" -- exactly what
 * `createRequireFamilyAuthorization` proves for its own closed operation
 * set, reusing the identical `AuthzRepository` primitive. Does NOT prove
 * Family-Owner authority -- mutation routes resolve that separately via
 * `FamilyCommercialAuthorityResolver` (see this file's header).
 *
 * Same fail-closed collapsing discipline as AuthzError: a malformed/missing
 * familyId param is 400 (routing error), a missing session is 401, and
 * every authorization failure (no scope row, REVOKED scope, no license) is
 * a single generic 403 -- never distinguishable by the caller.
 */
export function createRequireFamilyCommercialAuthorization(
  authzRepository: AuthzRepository,
  operation: FamilyCommercialOperation,
  now: () => Date = () => new Date(),
) {
  const requirements = resolveFamilyCommercialRequirements(operation);
  return async function requireFamilyCommercialAuthorization(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const familyId = (request.params as Record<string, unknown>).familyId;
    if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > MAX_FAMILY_ID_LENGTH) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    const accountId = request.accountId;
    if (typeof accountId !== 'string' || accountId.length === 0) {
      // Defensive only: every route this preHandler is attached to also
      // runs requireServiceSession first, which would already have 401'd.
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const status = await authzRepository.findFamilyScopeStatus(accountId, familyId);
    if (status !== 'ACTIVE') {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }

    if (requirements.requiresLicense) {
      const hasLicense = await authzRepository.hasActiveLicense(accountId, now());
      if (!hasLicense) {
        await reply.code(403).send({ error: 'forbidden' });
        return;
      }
    }
  };
}

export interface OwnerAuthorityCheckOutcome {
  readonly authorized: boolean;
  /** Present only when authorized is false -- lets the route map to the correct HTTP response (a generic 403 for ROLE_DENIED, a distinguishable 403 code for AUTHORITY_UNAVAILABLE), mirroring billingCheckoutRoutes.ts's own mapping exactly. */
  readonly denialStatus?: Exclude<FamilyCommercialAuthorityResult['status'], 'OWNER_AUTHORIZED'>;
}

/**
 * Resolves Family-Owner commercial authority for a mutation. Called
 * directly by a route handler (not wired as a preHandler) because it needs
 * the caller-supplied `actorDeviceId` from the request body -- identical
 * shape to billingCheckoutRoutes.ts's own inline resolution. AUTHORITY_UNAVAILABLE
 * is NEVER treated as authorized (fail closed): only an explicit
 * OWNER_AUTHORIZED result passes.
 */
export async function checkOwnerAuthority(
  resolver: FamilyCommercialAuthorityResolver,
  familyId: string,
  actorDeviceId: string,
): Promise<OwnerAuthorityCheckOutcome> {
  const result = await resolver.resolveOwnerAuthority(familyId, actorDeviceId);
  if (result.status === 'OWNER_AUTHORIZED') return { authorized: true };
  return { authorized: false, denialStatus: result.status };
}

export function isValidActorDeviceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ACTOR_DEVICE_ID_LENGTH;
}
