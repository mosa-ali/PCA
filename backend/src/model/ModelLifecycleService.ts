import { isLegalModelLifecycleTransition } from './policy.js';
import type { ModelLifecycleRepository } from './ModelLifecycleRepository.js';
import type { ModelEmergencyDirective, ModelEmergencyDirectiveVerifier } from './ModelEmergencyDirective.js';
import type { PackageVerificationGate } from './PackageVerificationGate.js';
import type { DeviceRuntimeCapability, ModelId, ModelLifecycleRecord, ModelLifecycleState, ModelPackageMetadata } from './types.js';
import type { ActionIdempotencyLedger } from '../familyrbac/ActionIdempotencyLedger.js';
import type { ReleaseRecord } from '../release/types.js';

export type ModelLifecycleErrorCode =
  | 'NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'ROLLBACK_TARGET_NOT_FOUND'
  | 'ROLLBACK_TARGET_NOT_KNOWN_GOOD'
  | 'ROLLBACK_TARGET_IS_SAME_MODEL'
  | 'KILL_SWITCH_NOT_APPLICABLE'
  | 'DIRECTIVE_WRONG_ACTION'
  | 'DIRECTIVE_WRONG_TARGET'
  | 'DIRECTIVE_MISSING_ROLLBACK_TARGET'
  | 'DIRECTIVE_SIGNATURE_INVALID';

export class ModelLifecycleError extends Error {
  readonly code: ModelLifecycleErrorCode;
  constructor(code: ModelLifecycleErrorCode) {
    super(MODEL_LIFECYCLE_ERROR_MESSAGES[code]);
    this.name = 'ModelLifecycleError';
    this.code = code;
  }
}

const MODEL_LIFECYCLE_ERROR_MESSAGES: Record<ModelLifecycleErrorCode, string> = {
  NOT_FOUND: 'Model lifecycle record does not exist.',
  ILLEGAL_TRANSITION: 'This lifecycle transition is not permitted from the current state.',
  ROLLBACK_TARGET_NOT_FOUND: 'Rollback target model does not exist.',
  ROLLBACK_TARGET_NOT_KNOWN_GOOD: 'Rollback target is not a previously verified/known-good package.',
  ROLLBACK_TARGET_IS_SAME_MODEL: 'Rollback target cannot be the currently active model itself.',
  KILL_SWITCH_NOT_APPLICABLE: 'Kill switch can only disable a currently ACTIVE model.',
  DIRECTIVE_WRONG_ACTION: 'Emergency directive action does not match this operation.',
  DIRECTIVE_WRONG_TARGET: "Emergency directive's modelId does not match the requested target.",
  DIRECTIVE_MISSING_ROLLBACK_TARGET: 'A ROLLBACK directive must name rollbackToModelId.',
  DIRECTIVE_SIGNATURE_INVALID: 'Emergency directive failed signature verification.',
};

const KNOWN_GOOD_ROLLBACK_STATES: ReadonlySet<ModelLifecycleState> = new Set(['VERIFIED', 'STAGED', 'ACTIVE', 'ROLLED_BACK']);

/**
 * doc 23/lane brief Section 25-29's orchestrator. Holds no verification
 * logic itself (see PackageVerificationGate) -- only the state machine and
 * the one piece of state a verification gate cannot own: which modelId is
 * currently ACTIVE per purpose, and the fail-closed guarantee that a
 * REJECTED/EXPIRED/DISABLED candidate never touches that pointer.
 */
export class ModelLifecycleService {
  private readonly repository: ModelLifecycleRepository;
  private readonly directiveVerifier: ModelEmergencyDirectiveVerifier;
  private readonly directiveLedger: ActionIdempotencyLedger;
  private readonly now: () => Date;

  constructor(
    repository: ModelLifecycleRepository,
    directiveVerifier: ModelEmergencyDirectiveVerifier,
    directiveLedger: ActionIdempotencyLedger,
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.directiveVerifier = directiveVerifier;
    this.directiveLedger = directiveLedger;
    this.now = now;
  }

  /** Verifies signature, one-time-id replay protection, and directive/target consistency -- shared by rollback() and disable(). Returns the cached prior outcome string for a replayed directiveId rather than re-executing. */
  private async verifyDirective(directive: ModelEmergencyDirective, expectedAction: ModelEmergencyDirective['action']): Promise<'FRESH' | 'REPLAYED'> {
    if (directive.action !== expectedAction) throw new ModelLifecycleError('DIRECTIVE_WRONG_ACTION');
    if (expectedAction === 'ROLLBACK' && directive.rollbackToModelId === null) {
      throw new ModelLifecycleError('DIRECTIVE_MISSING_ROLLBACK_TARGET');
    }

    const cached = this.directiveLedger.getRecorded(directive.directiveId);
    if (cached !== null) return 'REPLAYED';

    const signatureValid = await this.directiveVerifier.verify(directive);
    if (!signatureValid) throw new ModelLifecycleError('DIRECTIVE_SIGNATURE_INVALID');

    return 'FRESH';
  }

  async registerDiscovered(metadata: ModelPackageMetadata): Promise<ModelLifecycleRecord> {
    const record: ModelLifecycleRecord = {
      modelId: metadata.modelId,
      metadata,
      state: 'DISCOVERED',
      enteredStateAt: this.now(),
      lastVerificationFailureReason: null,
    };
    await this.repository.put(record);
    return record;
  }

  private async transition(modelId: ModelId, to: ModelLifecycleState, failureReason: ModelLifecycleRecord['lastVerificationFailureReason'] = null): Promise<ModelLifecycleRecord> {
    const record = await this.repository.get(modelId);
    if (record === null) throw new ModelLifecycleError('NOT_FOUND');
    if (!isLegalModelLifecycleTransition(record.state, to)) throw new ModelLifecycleError('ILLEGAL_TRANSITION');

    const updated: ModelLifecycleRecord = { ...record, state: to, enteredStateAt: this.now(), lastVerificationFailureReason: failureReason };
    await this.repository.put(updated);
    return updated;
  }

  async markDownloaded(modelId: ModelId): Promise<ModelLifecycleRecord> {
    return this.transition(modelId, 'DOWNLOADED');
  }

  async beginVerification(modelId: ModelId): Promise<ModelLifecycleRecord> {
    return this.transition(modelId, 'VERIFYING');
  }

  /**
   * doc 23: "A signature/hash failure, unsupported runtime, or failed
   * self-test retains the previous known-good artifact or deterministic-
   * only behavior; it is never silently replaced from an unverified
   * origin." A FAILED gate result transitions ONLY this candidate to
   * REJECTED -- it never reads or writes the active-model pointer, so
   * whatever was already ACTIVE for this purpose (if anything) is
   * completely untouched.
   */
  async completeVerification(
    modelId: ModelId,
    gate: PackageVerificationGate,
    release: ReleaseRecord,
    actualArtifactDigest: string,
    device: DeviceRuntimeCapability,
  ): Promise<ModelLifecycleRecord> {
    const record = await this.repository.get(modelId);
    if (record === null) throw new ModelLifecycleError('NOT_FOUND');

    const result = await gate.verify(record.metadata, release, actualArtifactDigest, device);
    if (result.outcome === 'FAILED') {
      return this.transition(modelId, 'REJECTED', result.reason);
    }
    return this.transition(modelId, 'VERIFIED');
  }

  async stage(modelId: ModelId): Promise<ModelLifecycleRecord> {
    return this.transition(modelId, 'STAGED');
  }

  /** Only reachable from STAGED (never directly from VERIFIED) -- a package always sits staged before it can affect any inference decision. Sets the active pointer for this package's own declared purpose. */
  async activate(modelId: ModelId): Promise<ModelLifecycleRecord> {
    const updated = await this.transition(modelId, 'ACTIVE');
    await this.repository.setActiveModelId(updated.metadata.purpose, modelId);
    return updated;
  }

  /**
   * doc 23 Section 4's "Emergency disable/rollback": target must ALREADY
   * be a known-good record (VERIFIED, STAGED, previously ACTIVE, or a
   * prior ROLLED_BACK target reused again) -- never a DISCOVERED/
   * DOWNLOADED/VERIFYING/REJECTED/EXPIRED/DISABLED record, closing a
   * downgrade-to-unverified-artifact rollback attack. Requires a
   * signature-verified ModelEmergencyDirective naming BOTH the currently
   * active model and the rollback target -- an unsigned or replayed
   * directiveId can never move the active pointer (lane brief Section 34:
   * "rollback attack," "kill-switch bypass").
   */
  async rollback(directive: ModelEmergencyDirective): Promise<{ rolledBack: ModelLifecycleRecord; newActive: ModelLifecycleRecord }> {
    if (directive.rollbackToModelId === null || directive.modelId === directive.rollbackToModelId) {
      throw new ModelLifecycleError('ROLLBACK_TARGET_IS_SAME_MODEL');
    }
    const replayState = await this.verifyDirective(directive, 'ROLLBACK');

    const targetModelId = directive.rollbackToModelId;
    const currentlyActiveModelId = directive.modelId;

    if (replayState === 'REPLAYED') {
      const rolledBack = await this.repository.get(currentlyActiveModelId);
      const newActive = await this.repository.get(targetModelId);
      if (rolledBack === null || newActive === null) throw new ModelLifecycleError('ROLLBACK_TARGET_NOT_FOUND');
      return { rolledBack, newActive };
    }

    const target = await this.repository.get(targetModelId);
    if (target === null) throw new ModelLifecycleError('ROLLBACK_TARGET_NOT_FOUND');
    if (!KNOWN_GOOD_ROLLBACK_STATES.has(target.state)) throw new ModelLifecycleError('ROLLBACK_TARGET_NOT_KNOWN_GOOD');

    const rolledBack = await this.transition(currentlyActiveModelId, 'ROLLED_BACK');

    const newActive: ModelLifecycleRecord =
      target.state === 'ACTIVE' ? target : { ...target, state: 'ACTIVE', enteredStateAt: this.now(), lastVerificationFailureReason: null };
    await this.repository.put(newActive);
    await this.repository.setActiveModelId(newActive.metadata.purpose, targetModelId);
    this.directiveLedger.record(directive.directiveId, { actionId: directive.directiveId, outcome: 'ROLLBACK_APPLIED' });

    return { rolledBack, newActive };
  }

  /**
   * doc 23/lane brief Section 29: inference stops, deterministic policy
   * remains available, the disabled model is never silently restored.
   * Requires the same signed ModelEmergencyDirective contract as
   * rollback() -- a kill switch that anyone can flip without
   * authorization is not a kill switch, it is a denial-of-service lever.
   */
  async disable(directive: ModelEmergencyDirective): Promise<ModelLifecycleRecord> {
    if (directive.modelId.length === 0) throw new ModelLifecycleError('DIRECTIVE_WRONG_TARGET');
    const replayState = await this.verifyDirective(directive, 'DISABLE');
    const modelId = directive.modelId;

    if (replayState === 'REPLAYED') {
      const record = await this.repository.get(modelId);
      if (record === null) throw new ModelLifecycleError('NOT_FOUND');
      return record;
    }

    const record = await this.repository.get(modelId);
    if (record === null) throw new ModelLifecycleError('NOT_FOUND');
    if (record.state !== 'ACTIVE') throw new ModelLifecycleError('KILL_SWITCH_NOT_APPLICABLE');

    const disabled = await this.transition(modelId, 'DISABLED');
    const currentActive = await this.repository.getActiveModelId(record.metadata.purpose);
    if (currentActive === modelId) await this.repository.setActiveModelId(record.metadata.purpose, null);
    this.directiveLedger.record(directive.directiveId, { actionId: directive.directiveId, outcome: 'DISABLE_APPLIED' });
    return disabled;
  }

  async expireIfPast(modelId: ModelId): Promise<ModelLifecycleRecord> {
    const record = await this.repository.get(modelId);
    if (record === null) throw new ModelLifecycleError('NOT_FOUND');
    if (record.metadata.expiresAt.getTime() > this.now().getTime()) return record;

    const expired = await this.transition(modelId, 'EXPIRED');
    const currentActive = await this.repository.getActiveModelId(record.metadata.purpose);
    if (currentActive === modelId) await this.repository.setActiveModelId(record.metadata.purpose, null);
    return expired;
  }

  async getActiveModelId(purpose: string): Promise<ModelId | null> {
    return this.repository.getActiveModelId(purpose);
  }
}
