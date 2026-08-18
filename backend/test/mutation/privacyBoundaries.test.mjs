// CURRENT_HEAD_MUTATION bounded tests for PCA-FR-137, PCA-NFR-014, and
// PCA-NFR-051. Mutation execution copies the backend to a temporary
// directory before changing any production source.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildRelayDiagnosticEvent, classifyCiphertextSize } from '../../dist/relay/diagnostics.js';
import { RelayService } from '../../dist/relay/RelayService.js';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function record(ciphertext = Buffer.from('opaque-marker')) {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    messageId: 'message-1',
    familyId: 'family-1',
    senderDeviceId: 'sender-1',
    recipientDeviceId: 'recipient-1',
    ciphertext,
    state: 'QUEUED',
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60_000),
    acknowledgedAt: null,
  };
}

test('FR-137 diagnostics retain only routing metadata at every size boundary', () => {
  assert.equal(classifyCiphertextSize(0), 'SMALL');
  assert.equal(classifyCiphertextSize(1_024), 'SMALL');
  assert.equal(classifyCiphertextSize(1_025), 'MEDIUM');
  assert.equal(classifyCiphertextSize(16 * 1_024), 'MEDIUM');
  assert.equal(classifyCiphertextSize(16 * 1_024 + 1), 'LARGE');

  const secret = 'opaque-family-payload-marker';
  const event = buildRelayDiagnosticEvent(record(Buffer.from(secret)), 'QUEUED');
  assert.deepEqual(Object.keys(event).sort(), [
    'acknowledgedAtUtc', 'ciphertextSizeClass', 'createdAtUtc', 'event',
    'expiresAtUtc', 'familyId', 'messageId', 'outcome', 'recipientDeviceId',
    'senderDeviceId', 'state',
  ].sort());
  assert.equal('ciphertext' in event, false);
  assert.equal(JSON.stringify(event).includes(secret), false);
});
test('FR-137 diagnostic sink failures never change relay delivery semantics', async () => {
  const service = new RelayService(
    createInMemoryRelayRepository(),
    () => new Date('2026-01-01T00:00:00.000Z'),
    () => { throw new Error('diagnostic sink unavailable'); },
  );
  const queued = await service.queueEnvelope({
    messageId: 'message-2',
    familyId: 'family-1',
    senderDeviceId: 'sender-1',
    recipientDeviceId: 'recipient-1',
    ciphertext: Buffer.from('opaque'),
  });
  assert.equal(queued.state, 'QUEUED');
});

test('FR-137 production server logger is explicitly disabled', () => {
  const source = readFileSync(path.join(TEST_ROOT, 'src', 'http', 'buildServer.ts'), 'utf8');
  assert.match(source, /Fastify\(\s*\{\s*logger:\s*false\s*\}\s*\)/);
});

function listTypeScriptFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...listTypeScriptFiles(full));
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

test('NFR-014 default-off backend has no telemetry or analytics ingestion route', () => {
  const root = path.join(TEST_ROOT, 'src', 'http');
  const prohibited = ['telemetry', 'analytics', '/collect', '/ingest', '/usage-report', '/metrics/report'];
  const routePattern = /\bapp\.(get|post|put|patch|delete)\(\s*[`'\"]([^`'\"]+)[`'\"]/g;
  const violations = [];
  for (const file of listTypeScriptFiles(root)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(routePattern)) {
      const route = match[2].toLowerCase();
      const term = prohibited.find((candidate) => route.includes(candidate));
      if (term) violations.push(`${file}:${route}:${term}`);
    }
  }
  assert.deepEqual(violations, []);
});
