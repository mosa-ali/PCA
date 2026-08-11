import assert from 'node:assert/strict';
import test from 'node:test';
import { PolicyEditorService } from '../dist/policyEditorService.js';
import { WellbeingValidationError } from '../dist/validators.js';
import {
  createCustomMessageCommand,
  updateCustomMessageCommand,
  archiveCustomMessageCommand,
  restoreCustomMessageCommand,
  enableCuratedMessageCommand,
  disableCuratedMessageCommand,
  updateTargetsCommand,
} from '../dist/commands.js';
import { basePolicy, baseMessage, baseIdentity } from './fixtures.mjs';

const NOW = '2026-02-01T00:00:00.000Z';

test('CREATE_CUSTOM_MESSAGE adds a message and advances the revision', () => {
  const editor = new PolicyEditorService(basePolicy());
  const message = baseMessage();
  const result = editor.apply(createCustomMessageCommand(baseIdentity(), message), NOW);
  assert.equal(result.kind, 'APPLIED');
  assert.equal(result.policy.policyRevision, 2);
  assert.equal(result.policy.customMessages.length, 1);
  assert.equal(result.policy.customMessages[0].messageId, message.messageId);
  assert.equal(result.audit.actionType, 'CREATE_CUSTOM_MESSAGE');
  assert.equal(result.audit.messageId, message.messageId);
});

test('CREATE_CUSTOM_MESSAGE rejects an unsafe message before mutating the policy', () => {
  const editor = new PolicyEditorService(basePolicy());
  const unsafe = baseMessage({ languageTexts: { en: { title: '<script>x</script>', body: 'Body' } } });
  assert.throws(() => editor.apply(createCustomMessageCommand(baseIdentity(), unsafe), NOW), WellbeingValidationError);
  assert.equal(editor.currentPolicy.customMessages.length, 0);
  assert.equal(editor.currentPolicy.policyRevision, 1);
});

test('UPDATE_CUSTOM_MESSAGE edits an existing message in place', () => {
  const message = baseMessage();
  let editor = new PolicyEditorService(basePolicy({ customMessages: [message] }));
  const updated = { ...message, languageTexts: { en: { title: 'New title', body: 'New body' } } };
  const result = editor.apply(updateCustomMessageCommand(baseIdentity(), message.messageId, updated), NOW);
  assert.equal(result.kind, 'APPLIED');
  assert.equal(result.policy.customMessages[0].languageTexts.en.title, 'New title');
});

test('ARCHIVE_CUSTOM_MESSAGE disables the message and stamps archivedAt', () => {
  const message = baseMessage();
  const editor = new PolicyEditorService(basePolicy({ customMessages: [message] }));
  const result = editor.apply(archiveCustomMessageCommand(baseIdentity(), message.messageId, NOW), NOW);
  assert.equal(result.kind, 'APPLIED');
  assert.equal(result.policy.customMessages[0].enabled, false);
  assert.equal(result.policy.customMessages[0].archivedAt, NOW);
});

test('RESTORE_CUSTOM_MESSAGE clears archivedAt', () => {
  const message = baseMessage({ archivedAt: '2026-01-15T00:00:00.000Z', enabled: false });
  const editor = new PolicyEditorService(basePolicy({ customMessages: [message] }));
  const result = editor.apply(restoreCustomMessageCommand(baseIdentity(), message.messageId), NOW);
  assert.equal(result.kind, 'APPLIED');
  assert.equal(result.policy.customMessages[0].archivedAt, undefined);
});

test('ENABLE_CURATED_MESSAGE / DISABLE_CURATED_MESSAGE toggle selection state', () => {
  let editor = new PolicyEditorService(basePolicy());
  let result = editor.apply(enableCuratedMessageCommand(baseIdentity(), 'sug-1'), NOW);
  assert.equal(result.policy.selectedCuratedSuggestionIds[0].enabled, true);

  editor = new PolicyEditorService(result.policy);
  result = editor.apply(disableCuratedMessageCommand(baseIdentity({ operationId: 'op-2', expectedRevision: 2, newRevision: 3 }), 'sug-1'), NOW);
  assert.equal(result.policy.selectedCuratedSuggestionIds[0].enabled, false);
});

test('UPDATE_TARGETS replaces the policy-level target scope', () => {
  const editor = new PolicyEditorService(basePolicy());
  const targets = { mode: 'MULTIPLE_CHILDREN', childProfileIds: ['child-a', 'child-b'] };
  const result = editor.apply(updateTargetsCommand(baseIdentity({ targetScope: targets }), targets), NOW);
  assert.equal(result.kind, 'APPLIED');
  assert.deepEqual(result.policy.targets, targets);
});

test('a stale expectedRevision is rejected without mutating the policy', () => {
  const editor = new PolicyEditorService(basePolicy({ policyRevision: 5 }));
  const result = editor.apply(createCustomMessageCommand(baseIdentity(), baseMessage()), NOW);
  assert.equal(result.kind, 'STALE_REJECTED');
  assert.equal(editor.currentPolicy.customMessages.length, 0);
});

test('a duplicate operationId applied twice is a no-op the second time', () => {
  const editor = new PolicyEditorService(basePolicy());
  const command = createCustomMessageCommand(baseIdentity(), baseMessage());
  const first = editor.apply(command, NOW);
  assert.equal(first.kind, 'APPLIED');
  const second = editor.apply({ ...command, expectedRevision: 2, newRevision: 3 }, NOW);
  assert.equal(second.kind, 'DUPLICATE_NO_OP');
  assert.equal(editor.currentPolicy.policyRevision, 2);
  assert.equal(editor.currentPolicy.customMessages.length, 1);
});
