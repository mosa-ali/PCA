import type { ModelId } from './types.js';

export type ModelEmergencyAction = 'ROLLBACK' | 'DISABLE';

/**
 * doc 23 Section 4's governance table: "Emergency disable/rollback |
 * Incident/release owner | Signed rollback, incident record, regression
 * test before re-enable." Both ModelLifecycleService.rollback() and
 * .disable() require one of these, signature-verified, before they take
 * effect -- neither is a bare method call any caller can invoke. This
 * mirrors the contracts catalogue's existing SIGNED_ROLLBACK family-
 * envelope message type (`idempotency: "one-time-rollback-id"`,
 * `route: "explicitly-authorized-parent-to-target"`) rather than inventing
 * a new one; `directiveId` plays the same one-time-id role.
 */
export interface ModelEmergencyDirective {
  directiveId: string;
  action: ModelEmergencyAction;
  modelId: ModelId;
  /** Required and meaningful only for ROLLBACK -- the known-good target to roll back to. */
  rollbackToModelId: ModelId | null;
  issuedAt: Date;
  /** Opaque signature over the directive's own canonical bytes. This module never verifies it itself (crypto boundary, lane brief Section 27) -- only ModelEmergencyDirectiveVerifier does. */
  signature: string;
}

/** Crypto boundary: no signature math lives in this module, only this injected verification port. Production wiring is PENDING_HUMAN_SECURITY_REVIEW. */
export interface ModelEmergencyDirectiveVerifier {
  verify(directive: ModelEmergencyDirective): Promise<boolean>;
}
