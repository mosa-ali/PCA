import type { EyeProtectionSettings, EyeProtectionSettingsRepository } from './EyeProtectionSettingsRepository.js';
import type { ParentActionAuthorizationService } from '../familyrbac/ParentActionAuthorizationService.js';

export type EyeProtectionErrorCode = 'NOT_AUTHORIZED';

export class EyeProtectionError extends Error {
  readonly code: EyeProtectionErrorCode;
  constructor(code: EyeProtectionErrorCode) {
    super(EYE_PROTECTION_ERROR_MESSAGES[code]);
    this.name = 'EyeProtectionError';
    this.code = code;
  }
}

const EYE_PROTECTION_ERROR_MESSAGES: Record<EyeProtectionErrorCode, string> = {
  NOT_AUTHORIZED: 'The acting device is not authorized to edit this child\'s eye-protection setting.',
};

/**
 * PCA eye-protection reminders: the parent-authorized write path for the
 * per-child reminders-enabled toggle. Reuses the SAME EDIT_CHILD_POLICY
 * ParentOperation and CHILD_PROFILE targetScope pre-check
 * childPolicyRoutes.ts's schedule-policy route already establishes for
 * per-child settings mutations (see ParentActionAuthorizationService's own
 * doc comment: this is an advisory pre-check, not the final authority) --
 * this service does not invent a second authorization matrix. Unlike the
 * schedule-policy route, the setting itself is a plain, non-E2EE boolean
 * preference (see EyeProtectionSettingsRepository's own doc comment for
 * why that is the correct, reviewed posture for this specific field), so
 * this service writes it directly via the injected repository rather than
 * relaying an opaque encrypted envelope.
 */
export class EyeProtectionSettingsService {
  private readonly repository: EyeProtectionSettingsRepository;
  private readonly authorization: Pick<ParentActionAuthorizationService, 'authorize'>;
  private readonly now: () => Date;

  constructor(
    repository: EyeProtectionSettingsRepository,
    authorization: Pick<ParentActionAuthorizationService, 'authorize'>,
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.authorization = authorization;
    this.now = now;
  }

  async get(familyId: string, childProfileId: string): Promise<EyeProtectionSettings> {
    return this.repository.get(familyId, childProfileId);
  }

  async updateReminders(
    familyId: string,
    childProfileId: string,
    actorDeviceId: string,
    remindersEnabled: boolean,
    idempotencyKey: string,
    actionId: string,
  ): Promise<EyeProtectionSettings> {
    const issuedAt = this.now();
    const decision = this.authorization.authorize({
      familyId,
      actorDeviceId,
      operation: 'EDIT_CHILD_POLICY',
      targetScope: { kind: 'CHILD_PROFILE', id: childProfileId },
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 60_000),
      stepUp: null,
      idempotencyKey,
      actionId,
    });
    if (decision.verdict !== 'ALLOW') throw new EyeProtectionError('NOT_AUTHORIZED');

    return this.repository.update(familyId, childProfileId, { remindersEnabled });
  }
}
