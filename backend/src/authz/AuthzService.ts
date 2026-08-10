import { resolveRequirements } from './policy.js';
import type { AuthzRepository } from './AuthzRepository.js';
import type { AuthorizationContext } from './types.js';

export type AuthzErrorCode = 'FORBIDDEN';

/**
 * Deliberately ONE generic code/message for every authorization failure --
 * "wrong family," "no scope at all," "family doesn't exist," and "license
 * inactive" must all be indistinguishable to the caller. Distinguishing
 * them would let a caller enumerate which families/accounts exist.
 */
export class AuthzError extends Error {
  readonly code: AuthzErrorCode;
  constructor() {
    super('This operation is not authorized.');
    this.name = 'AuthzError';
    this.code = 'FORBIDDEN';
  }
}

export class AuthzService {
  private readonly repository: AuthzRepository;
  private readonly now: () => Date;

  constructor(repository: AuthzRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  /**
   * Throws AuthzError if not authorized; resolves with no value if
   * authorized. This method only ever answers "may this account perform
   * this service-plane operation" -- it never returns or implies a family
   * role, and it never authorizes any of the operations deliberately
   * absent from ServiceOperation (policy update, family role change,
   * retention control, child removal, family activity read).
   */
  async authorize(context: AuthorizationContext): Promise<void> {
    const requirements = resolveRequirements(context.operation);

    if (requirements.requiresFamilyScope) {
      if (!context.familyId) throw new AuthzError();
      const status = await this.repository.findFamilyScopeStatus(context.accountId, context.familyId);
      if (status !== 'ACTIVE') throw new AuthzError();
    }

    if (requirements.requiresLicense) {
      const hasLicense = await this.repository.hasActiveLicense(context.accountId, this.now());
      if (!hasLicense) throw new AuthzError();
    }
  }
}
