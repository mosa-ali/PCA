import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthzError, type AuthzService } from '../authz/AuthzService.js';
import type { ServiceOperation } from '../authz/types.js';
import type { FamilyMembershipRepository, FamilyMembershipRole } from '../familymembers/FamilyMembershipRepository.js';
import type { OpaqueFamilyId } from '../familymembers/types.js';

const MAX_FAMILY_ID_LENGTH = 128;

/**
 * Must run AFTER requireServiceSession (so request.accountId is already
 * set). Extracts familyId from the route's `:familyId` URL parameter and
 * enforces the given ServiceOperation via AuthzService BEFORE the route
 * handler runs. The production repository requires both the active service
 * scope and matching active Parent membership. PairingService and
 * InvitationService deliberately trust this boundary and perform only
 * family-scoped data access.
 *
 * Authenticated-but-forbidden replies 403; a malformed/missing familyId
 * param replies 400 (a routing/client error, not an authorization
 * decision) before ever reaching AuthzService.
 */
export function createRequireFamilyAuthorization(authzService: AuthzService, operation: ServiceOperation) {
  return async function requireFamilyAuthorization(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const familyId = (request.params as Record<string, unknown>).familyId;
    if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > MAX_FAMILY_ID_LENGTH) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    try {
      await authzService.authorize({ accountId: request.accountId as string, operation, familyId });
    } catch (error) {
      if (error instanceof AuthzError) {
        await reply.code(403).send({ error: 'forbidden' });
        return;
      }
      throw error;
    }
  };
}

/** A service scope proves the requested family boundary; this check supplies
 * the normal Parent role required for the individual action. */
export function createRequireFamilyMembershipRole(
  repository: Pick<FamilyMembershipRepository, 'findActiveRoleByServiceAccountId'>,
  allowedRoles: ReadonlySet<FamilyMembershipRole>,
) {
  return async function requireFamilyMembershipRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const familyId = (request.params as Record<string, unknown>).familyId;
    const serviceAccountId = request.accountId;
    if (typeof familyId !== 'string' || familyId.length === 0 || familyId.length > MAX_FAMILY_ID_LENGTH || typeof serviceAccountId !== 'string') {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    const role = await repository.findActiveRoleByServiceAccountId(serviceAccountId, familyId as OpaqueFamilyId);
    if (role === null || !allowedRoles.has(role)) await reply.code(403).send({ error: 'forbidden' });
  };
}
