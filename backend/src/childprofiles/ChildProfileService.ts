import type { ChildProfileMembershipRow, ChildProfileRegistryRepository } from './ChildProfileRegistryRepository.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 191; // matches the column's VARCHAR(191)

export type ChildProfileErrorCode = 'INVALID_IDEMPOTENCY_KEY';

/** Message text is always a fixed, generic string per code -- matching InvitationError's own convention. */
export class ChildProfileError extends Error {
  readonly code: ChildProfileErrorCode;
  constructor(code: ChildProfileErrorCode) {
    super('This request could not be processed.');
    this.name = 'ChildProfileError';
    this.code = code;
  }
}

export interface CreateChildProfileResult {
  childProfileId: string;
  createdAtUtc: string;
}

/**
 * The service layer for the opaque child-profile membership registry.
 * Authorization (is this account allowed to manage this family's children)
 * happens entirely BEFORE this service is ever reached -- see
 * childProfileRoutes.ts's preHandler chain, which mirrors
 * invitationRoutes.ts's CREATE_INVITATION guard exactly. This class
 * performs no authorization of its own, only family-scoped data access --
 * same division of responsibility as EyeProtectionSettingsService and
 * InvitationService.
 *
 * NEVER accepts, stores, or returns a readable child field. The one
 * caller-supplied value this service touches besides familyId is an
 * OPTIONAL idempotency key -- an operational retry-safety value, not
 * child-profile content.
 */
export class ChildProfileService {
  private readonly repository: ChildProfileRegistryRepository;
  private readonly now: () => Date;

  constructor(repository: ChildProfileRegistryRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async createChildProfile(familyId: string, idempotencyKey: string | null): Promise<CreateChildProfileResult> {
    if (idempotencyKey !== null && (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)) {
      throw new ChildProfileError('INVALID_IDEMPOTENCY_KEY');
    }
    const outcome = await this.repository.create(familyId, idempotencyKey, this.now());
    return { childProfileId: outcome.row.childProfileId, createdAtUtc: outcome.row.createdAtUtc };
  }

  async listChildProfiles(familyId: string): Promise<ChildProfileMembershipRow[]> {
    return this.repository.listForFamily(familyId);
  }
}
