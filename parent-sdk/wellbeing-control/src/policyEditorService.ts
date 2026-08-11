import { RevisionGuard } from './revisionGuard.js';
import type {
  WellbeingAuditEntry,
  WellbeingCommand,
  WellbeingMessageControlV1,
} from './types.js';
import { assertValidCustomMessage, validateTargetScope, WellbeingValidationError } from './validators.js';

export type ApplyCommandResult =
  | { readonly kind: 'APPLIED'; readonly policy: WellbeingMessageControlV1; readonly audit: WellbeingAuditEntry }
  | { readonly kind: 'DUPLICATE_NO_OP'; readonly operationId: string }
  | { readonly kind: 'STALE_REJECTED'; readonly expectedRevision: number; readonly currentRevision: number };

/**
 * Applies parent commands to a WellbeingMessageControlV1 document in
 * memory, enforcing revision monotonicity (doc 36 section 10) and mechanical
 * safety validation (doc 36 section 7) before any mutation is accepted.
 *
 * This service does not perform FTS/actor authorization (doc 36 section 4,
 * section 11) -- that belongs to the trusted endpoint integration wired by
 * the coordinator. It is a local, single-writer document editor.
 */
export class PolicyEditorService {
  private readonly guard: RevisionGuard;

  constructor(private policy: WellbeingMessageControlV1) {
    this.guard = new RevisionGuard(policy.policyRevision);
  }

  get currentPolicy(): WellbeingMessageControlV1 {
    return this.policy;
  }

  apply(command: WellbeingCommand, nowUtc: string): ApplyCommandResult {
    const outcome = this.guard.evaluate(command.operationId, command.expectedRevision, command.newRevision);
    if (outcome.kind !== 'ACCEPTED') return outcome;

    const nextPolicy = this.reduce(command);
    const issues = validateTargetScope(command.targetScope);
    if (issues.length > 0) throw new WellbeingValidationError(issues);

    this.policy = { ...nextPolicy, policyRevision: command.newRevision, updatedAt: nowUtc };
    this.guard.commit(command.operationId, command.newRevision);

    const audit: WellbeingAuditEntry = {
      actionType: command.type,
      actorOpaqueId: command.actorMemberId,
      targetOpaqueId: targetOpaqueIdOf(command),
      messageId: messageIdOf(command),
      policyRevision: command.newRevision,
      timestampUtc: nowUtc,
      operationId: command.operationId,
    };
    return { kind: 'APPLIED', policy: this.policy, audit };
  }

  private reduce(command: WellbeingCommand): WellbeingMessageControlV1 {
    switch (command.type) {
      case 'CREATE_CUSTOM_MESSAGE': {
        assertValidCustomMessage(command.payload.message);
        return { ...this.policy, customMessages: [...this.policy.customMessages, command.payload.message] };
      }
      case 'UPDATE_CUSTOM_MESSAGE': {
        assertValidCustomMessage(command.payload.message);
        return {
          ...this.policy,
          customMessages: this.policy.customMessages.map((m) => (m.messageId === command.payload.messageId ? command.payload.message : m)),
        };
      }
      case 'ARCHIVE_CUSTOM_MESSAGE': {
        return {
          ...this.policy,
          customMessages: this.policy.customMessages.map((m) =>
            m.messageId === command.payload.messageId ? { ...m, enabled: false, archivedAt: command.payload.archivedAt } : m,
          ),
        };
      }
      case 'RESTORE_CUSTOM_MESSAGE': {
        return {
          ...this.policy,
          customMessages: this.policy.customMessages.map((m) =>
            m.messageId === command.payload.messageId ? { ...m, archivedAt: undefined } : m,
          ),
        };
      }
      case 'ENABLE_CURATED_MESSAGE': {
        return { ...this.policy, selectedCuratedSuggestionIds: setCuratedEnabled(this.policy.selectedCuratedSuggestionIds, command.payload.suggestionId, true) };
      }
      case 'DISABLE_CURATED_MESSAGE': {
        return { ...this.policy, selectedCuratedSuggestionIds: setCuratedEnabled(this.policy.selectedCuratedSuggestionIds, command.payload.suggestionId, false) };
      }
      case 'UPDATE_DELIVERY_POLICY': {
        return {
          ...this.policy,
          customMessages: this.policy.customMessages.map((m) => {
            if (m.messageId !== command.payload.messageId) return m;
            const updated = { ...m, delivery: command.payload.delivery };
            assertValidCustomMessage(updated);
            return updated;
          }),
        };
      }
      case 'UPDATE_TARGETS': {
        return { ...this.policy, targets: command.payload.targets };
      }
    }
  }
}

function setCuratedEnabled(
  selections: WellbeingMessageControlV1['selectedCuratedSuggestionIds'],
  suggestionId: string,
  enabled: boolean,
): WellbeingMessageControlV1['selectedCuratedSuggestionIds'] {
  const existing = selections.find((s) => s.suggestionId === suggestionId);
  if (existing === undefined) return [...selections, { suggestionId, enabled }];
  return selections.map((s) => (s.suggestionId === suggestionId ? { ...s, enabled } : s));
}

function messageIdOf(command: WellbeingCommand): string | undefined {
  switch (command.type) {
    case 'CREATE_CUSTOM_MESSAGE':
      return command.payload.message.messageId;
    case 'UPDATE_CUSTOM_MESSAGE':
    case 'ARCHIVE_CUSTOM_MESSAGE':
    case 'RESTORE_CUSTOM_MESSAGE':
    case 'UPDATE_DELIVERY_POLICY':
      return command.payload.messageId;
    default:
      return undefined;
  }
}

function targetOpaqueIdOf(command: WellbeingCommand): string {
  const scope = command.targetScope;
  if (scope.mode === 'ALL_CHILDREN') return 'ALL_CHILDREN';
  return scope.childProfileIds.join(',');
}
