import type {
  ArchiveCustomMessageCommand,
  CreateCustomMessageCommand,
  CustomWellbeingMessage,
  DeliveryPolicy,
  DisableCuratedMessageCommand,
  EnableCuratedMessageCommand,
  RestoreCustomMessageCommand,
  TargetScope,
  UpdateCustomMessageCommand,
  UpdateDeliveryPolicyCommand,
  UpdateTargetsCommand,
} from './types.js';

export interface CommandIdentity {
  readonly operationId: string;
  readonly actorMemberId: string;
  readonly expectedRevision: number;
  readonly newRevision: number;
  readonly targetScope: TargetScope;
}

/**
 * Pure command constructors. Callers supply identity/revision fields
 * explicitly (rather than this module generating operationId/timestamps)
 * so command construction stays deterministic and independently testable;
 * a thin wrapper in the consuming application can inject
 * crypto.randomUUID()/clock values at the call site.
 */
export function createCustomMessageCommand(identity: CommandIdentity, message: CustomWellbeingMessage): CreateCustomMessageCommand {
  return { type: 'CREATE_CUSTOM_MESSAGE', ...identity, payload: { message } };
}

export function updateCustomMessageCommand(identity: CommandIdentity, messageId: string, message: CustomWellbeingMessage): UpdateCustomMessageCommand {
  return { type: 'UPDATE_CUSTOM_MESSAGE', ...identity, payload: { messageId, message } };
}

export function archiveCustomMessageCommand(identity: CommandIdentity, messageId: string, archivedAt: string): ArchiveCustomMessageCommand {
  return { type: 'ARCHIVE_CUSTOM_MESSAGE', ...identity, payload: { messageId, archivedAt } };
}

export function restoreCustomMessageCommand(identity: CommandIdentity, messageId: string): RestoreCustomMessageCommand {
  return { type: 'RESTORE_CUSTOM_MESSAGE', ...identity, payload: { messageId } };
}

export function enableCuratedMessageCommand(identity: CommandIdentity, suggestionId: string): EnableCuratedMessageCommand {
  return { type: 'ENABLE_CURATED_MESSAGE', ...identity, payload: { suggestionId } };
}

export function disableCuratedMessageCommand(identity: CommandIdentity, suggestionId: string): DisableCuratedMessageCommand {
  return { type: 'DISABLE_CURATED_MESSAGE', ...identity, payload: { suggestionId } };
}

export function updateDeliveryPolicyCommand(identity: CommandIdentity, messageId: string, delivery: DeliveryPolicy): UpdateDeliveryPolicyCommand {
  return { type: 'UPDATE_DELIVERY_POLICY', ...identity, payload: { messageId, delivery } };
}

export function updateTargetsCommand(identity: CommandIdentity, targets: TargetScope): UpdateTargetsCommand {
  return { type: 'UPDATE_TARGETS', ...identity, payload: { targets } };
}
