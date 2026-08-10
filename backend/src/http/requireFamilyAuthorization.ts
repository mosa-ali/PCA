import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthzError, type AuthzService } from '../authz/AuthzService.js';
import type { ServiceOperation } from '../authz/types.js';

const MAX_FAMILY_ID_LENGTH = 128;

/**
 * Must run AFTER requireServiceSession (so request.accountId is already
 * set). Extracts familyId from the route's `:familyId` URL parameter and
 * enforces the given ServiceOperation via AuthzService BEFORE the route
 * handler runs. PairingService and InvitationService's family-scoped
 * methods deliberately trust that this has already happened -- they
 * perform no authorization of their own, only family-scoped data access.
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
