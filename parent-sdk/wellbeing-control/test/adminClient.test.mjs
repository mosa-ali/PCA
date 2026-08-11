import assert from 'node:assert/strict';
import test from 'node:test';
import { MockWellbeingMessageAdminClient } from '../dist/adminClient.js';
import { createCustomMessageCommand } from '../dist/commands.js';
import { basePolicy, baseMessage, baseIdentity } from './fixtures.mjs';

test('createCustomMessage applies the command and publishPolicy returns a canonical payload', async () => {
  const client = new MockWellbeingMessageAdminClient({ initialPolicy: basePolicy(), now: () => '2026-02-01T00:00:00.000Z' });
  const message = baseMessage();
  const result = await client.createCustomMessage(createCustomMessageCommand(baseIdentity(), message));
  assert.equal(result.kind, 'APPLIED');

  const published = await client.publishPolicy();
  assert.equal(typeof published.canonicalPayload, 'string');
  assert.equal(published.policy.customMessages.length, 1);
  assert.equal(client.audit.length, 1);
});

test('previewMessage delegates to the preview model and redacts on lock screen', async () => {
  const message = baseMessage();
  const client = new MockWellbeingMessageAdminClient({ initialPolicy: basePolicy({ customMessages: [message] }) });
  const card = await client.previewMessage(message.messageId, 'LOCK_SCREEN_REDACTED');
  assert.equal(card.redacted, true);
});

test('listCuratedSuggestions returns the configured catalogue', async () => {
  const suggestions = [{ suggestionId: 'sug-1', category: 'READING', languageTexts: { en: { title: 'Read', body: 'Read a book today.' } } }];
  const client = new MockWellbeingMessageAdminClient({ initialPolicy: basePolicy(), curatedSuggestions: suggestions });
  assert.deepEqual(await client.listCuratedSuggestions(), suggestions);
});

test('getPolicy reflects the current in-memory state after a command', async () => {
  const client = new MockWellbeingMessageAdminClient({ initialPolicy: basePolicy(), now: () => '2026-02-01T00:00:00.000Z' });
  await client.createCustomMessage(createCustomMessageCommand(baseIdentity(), baseMessage()));
  const policy = await client.getPolicy();
  assert.equal(policy.policyRevision, 2);
});
