/**
 * WellbeingMessageAdminClient -- the shared UI contract (doc 36 section 20)
 * that Agent 7's parent-web can consume. `MockWellbeingMessageAdminClient`
 * is an in-memory reference implementation Agent 7 may use before the
 * Coordinator wires the real, endpoint-backed implementation.
 */

import { canonicalizePolicy } from './canonicalize.js';
import { buildPreviewCard, type PreviewCard } from './previewModel.js';
import { PolicyEditorService, type ApplyCommandResult } from './policyEditorService.js';
import type {
  CuratedSuggestion,
  CustomWellbeingMessage,
  LanguageTag,
  PreviewSurface,
  ScheduleWindow,
  TargetScope,
  WellbeingAuditEntry,
  WellbeingCommand,
  WellbeingMessageControlV1,
} from './types.js';

export interface WellbeingMessageAdminClient {
  listCuratedSuggestions(): Promise<readonly CuratedSuggestion[]>;
  getPolicy(): Promise<WellbeingMessageControlV1>;
  createCustomMessage(command: WellbeingCommand & { readonly type: 'CREATE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult>;
  updateCustomMessage(command: WellbeingCommand & { readonly type: 'UPDATE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult>;
  archiveMessage(command: WellbeingCommand & { readonly type: 'ARCHIVE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult>;
  restoreMessage(command: WellbeingCommand & { readonly type: 'RESTORE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult>;
  setCuratedEnabled(
    command: WellbeingCommand & { readonly type: 'ENABLE_CURATED_MESSAGE' | 'DISABLE_CURATED_MESSAGE' },
  ): Promise<ApplyCommandResult>;
  updateSchedule(messageId: string, schedule: ScheduleWindow): Promise<CustomWellbeingMessage>;
  updateTargets(command: WellbeingCommand & { readonly type: 'UPDATE_TARGETS' }): Promise<ApplyCommandResult>;
  previewMessage(messageId: string, surface: PreviewSurface, languageTag?: LanguageTag): Promise<PreviewCard>;
  publishPolicy(): Promise<{ readonly canonicalPayload: string; readonly policy: WellbeingMessageControlV1 }>;
}

export interface MockWellbeingMessageAdminClientOptions {
  readonly initialPolicy: WellbeingMessageControlV1;
  readonly curatedSuggestions?: readonly CuratedSuggestion[];
  readonly now?: () => string;
}

/**
 * In-memory reference implementation. It applies the same validation and
 * revision-guard rules the real client will (via PolicyEditorService) so
 * UI development against the mock exercises real acceptance/rejection
 * behavior, not a stub that always succeeds.
 */
export class MockWellbeingMessageAdminClient implements WellbeingMessageAdminClient {
  private readonly editor: PolicyEditorService;
  private readonly curated: readonly CuratedSuggestion[];
  private readonly now: () => string;
  private readonly auditLog: WellbeingAuditEntry[] = [];

  constructor(options: MockWellbeingMessageAdminClientOptions) {
    this.editor = new PolicyEditorService(options.initialPolicy);
    this.curated = options.curatedSuggestions ?? [];
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get audit(): readonly WellbeingAuditEntry[] {
    return this.auditLog;
  }

  async listCuratedSuggestions(): Promise<readonly CuratedSuggestion[]> {
    return this.curated;
  }

  async getPolicy(): Promise<WellbeingMessageControlV1> {
    return this.editor.currentPolicy;
  }

  private applyAndRecord(command: WellbeingCommand): ApplyCommandResult {
    const result = this.editor.apply(command, this.now());
    if (result.kind === 'APPLIED') this.auditLog.push(result.audit);
    return result;
  }

  async createCustomMessage(command: WellbeingCommand & { readonly type: 'CREATE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult> {
    return this.applyAndRecord(command);
  }

  async updateCustomMessage(command: WellbeingCommand & { readonly type: 'UPDATE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult> {
    return this.applyAndRecord(command);
  }

  async archiveMessage(command: WellbeingCommand & { readonly type: 'ARCHIVE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult> {
    return this.applyAndRecord(command);
  }

  async restoreMessage(command: WellbeingCommand & { readonly type: 'RESTORE_CUSTOM_MESSAGE' }): Promise<ApplyCommandResult> {
    return this.applyAndRecord(command);
  }

  async setCuratedEnabled(
    command: WellbeingCommand & { readonly type: 'ENABLE_CURATED_MESSAGE' | 'DISABLE_CURATED_MESSAGE' },
  ): Promise<ApplyCommandResult> {
    return this.applyAndRecord(command);
  }

  async updateSchedule(messageId: string, schedule: ScheduleWindow): Promise<CustomWellbeingMessage> {
    const message = this.editor.currentPolicy.customMessages.find((m) => m.messageId === messageId);
    if (message === undefined) throw new Error(`no such custom message: ${messageId}`);
    return { ...message, schedule };
  }

  async updateTargets(command: WellbeingCommand & { readonly type: 'UPDATE_TARGETS' }): Promise<ApplyCommandResult> {
    return this.applyAndRecord(command);
  }

  async previewMessage(messageId: string, surface: PreviewSurface, languageTag?: LanguageTag): Promise<PreviewCard> {
    const message = this.editor.currentPolicy.customMessages.find((m) => m.messageId === messageId);
    if (message === undefined) throw new Error(`no such custom message: ${messageId}`);
    return buildPreviewCard(message, surface, languageTag);
  }

  async publishPolicy(): Promise<{ readonly canonicalPayload: string; readonly policy: WellbeingMessageControlV1 }> {
    const policy = this.editor.currentPolicy;
    return { canonicalPayload: canonicalizePolicy(policy), policy };
  }
}
