import type { FamilyMembershipRepository } from '../../familymembers/FamilyMembershipRepository.js';
import type { ParentAccountRepository } from '../ParentAccountRepository.js';
import type { CommercialStepUpOperation } from './ParentMfaRepository.js';
import type { ParentMfaService } from './ParentMfaService.js';

export type CommercialOwnerAuthorityResult = 'OWNER_AUTHORIZED' | 'ROLE_DENIED' | 'STEP_UP_REQUIRED';

/**
 * PCA-DEC-037: COMMERCIAL_OWNER_AUTHORITY = FAMILY ADMINISTRATOR + FRESH TOTP
 * STEP-UP. Replaces the Genesis/device-signature owner-attestation gate on
 * every sensitive commercial mutation (checkout, commercial request
 * create/cancel, auto-renew cancel/resume). Read-only billing is unaffected.
 *
 * Every check is server-side and evaluated per request, in this order:
 *   1. the session's service account maps to a VERIFIED, enabled Parent
 *      account whose family is exactly the target family (wrong family,
 *      disabled, or unknown -> ROLE_DENIED);
 *   2. that account holds the ACTIVE ADMINISTRATOR membership of the family
 *      (VIEWER, CHILD, revoked -> ROLE_DENIED);
 *   3. a step-up grant minted by a fresh TOTP code for THIS account, THIS
 *      family and THIS operation is consumed atomically, once, before expiry
 *      (absent, expired, replayed, other operation -> STEP_UP_REQUIRED).
 *
 * The step-up grant is consumed only after (1) and (2) pass, so a denied
 * caller can never burn a legitimate administrator's grant.
 */
export class ParentCommercialStepUpAuthority {
  constructor(
    private readonly deps: {
      accounts: Pick<ParentAccountRepository, 'findByServiceAccountId'>;
      memberships: Pick<FamilyMembershipRepository, 'findActiveRole'>;
      mfa: Pick<ParentMfaService, 'posture' | 'consumeCommercialStepUp'>;
    },
  ) {}

  async authorize(serviceAccountId: string, familyId: string, operation: CommercialStepUpOperation, stepUpToken: unknown): Promise<CommercialOwnerAuthorityResult> {
    const account = await this.deps.accounts.findByServiceAccountId(serviceAccountId);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null || account.familyId !== familyId) return 'ROLE_DENIED';
    if ((await this.deps.memberships.findActiveRole(account.accountId, familyId)) !== 'ADMINISTRATOR') return 'ROLE_DENIED';
    if ((await this.deps.mfa.posture(account.accountId)).status !== 'ACTIVE') return 'STEP_UP_REQUIRED';
    return (await this.deps.mfa.consumeCommercialStepUp(account.accountId, familyId, operation, stepUpToken)) ? 'OWNER_AUTHORIZED' : 'STEP_UP_REQUIRED';
  }
}
