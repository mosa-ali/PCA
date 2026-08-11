import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportManifest } from '../../dist/export/manifest.js';
import { runExport } from '../../dist/export/pipeline.js';
import { createTestOnlyExportEncryptor, createFailingExportEncryptor } from '../support/testOnlyExportEncryptor.mjs';

function records() {
  return [
    { entityClass: 'WEB_VISIT', id: 'w1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') },
    { entityClass: 'USAGE_SESSION', id: 'u1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') },
  ];
}

function buildManifest(overrides = {}) {
  return buildExportManifest({
    exportId: 'export-1',
    createdAtUtc: new Date('2026-02-01T00:00:00.000Z'),
    records: records(),
    dataBytes: Buffer.from('plaintext-payload'),
    retentionCutoffUtc: new Date('2026-01-15T00:00:00.000Z'),
    schemaVersions: { WEB_VISIT: '1', USAGE_SESSION: '1' },
    ...overrides,
  });
}

function inMemorySink() {
  const writes = [];
  return {
    writes,
    async write(artifact) {
      writes.push(artifact);
    },
  };
}

// ---- manifest ----

test('manifest derives categories and counts from the actual record set, never independently supplied', () => {
  const manifest = buildManifest();
  assert.deepEqual(manifest.includedCategories.sort(), ['USAGE_SESSION', 'WEB_VISIT']);
  assert.deepEqual(manifest.recordCounts, { WEB_VISIT: 1, USAGE_SESSION: 1 });
});

test('manifest integrity digest is a deterministic function of the plaintext bytes', () => {
  const a = buildExportManifest({
    exportId: 'x',
    createdAtUtc: new Date(),
    records: [],
    dataBytes: Buffer.from('same-content'),
    retentionCutoffUtc: null,
    schemaVersions: {},
  });
  const b = buildExportManifest({
    exportId: 'y',
    createdAtUtc: new Date(),
    records: [],
    dataBytes: Buffer.from('same-content'),
    retentionCutoffUtc: null,
    schemaVersions: {},
  });
  assert.equal(a.integrityDigest, b.integrityDigest);
});

test('manifest contains only metadata -- never the raw data bytes themselves', () => {
  const manifest = buildManifest();
  assert.equal(JSON.stringify(manifest).includes('plaintext-payload'), false);
});

// ---- pipeline happy path ----

test('a successful export encrypts before writing and never hands the sink plaintext', async () => {
  const manifest = buildManifest();
  const sink = inMemorySink();
  const outcome = await runExport(manifest, Buffer.from('plaintext-payload'), createTestOnlyExportEncryptor(), sink);
  assert.equal(outcome.kind, 'COMPLETED');
  assert.equal(sink.writes.length, 1);
  // The sink only ever receives the ENCRYPTOR's return value, never dataBytes directly --
  // proven by it carrying the encryptor's own wrapper marker, not a bare copy of the input.
  assert.ok(sink.writes[0].ciphertext.toString('utf8').startsWith('TEST-ONLY-CIPHERTEXT:'));
});

// ---- failure safety ----

test('export interrupted / provider failure during encryption: FAILED outcome, sink never invoked', async () => {
  const manifest = buildManifest();
  const sink = inMemorySink();
  const outcome = await runExport(manifest, Buffer.from('plaintext-payload'), createFailingExportEncryptor('disk full'), sink);
  assert.equal(outcome.kind, 'FAILED');
  assert.ok(outcome.failureReason.includes('ENCRYPTION_FAILED'));
  assert.equal(sink.writes.length, 0, 'no plaintext or partial artifact must ever reach the sink on encryption failure');
});

test('invalid destination / insufficient storage / partial write: FAILED outcome, distinguishable from encryption failure', async () => {
  const manifest = buildManifest();
  const failingSink = {
    async write() {
      throw new Error('ENOSPC: no space left on device');
    },
  };
  const outcome = await runExport(manifest, Buffer.from('plaintext-payload'), createTestOnlyExportEncryptor(), failingSink);
  assert.equal(outcome.kind, 'FAILED');
  assert.ok(outcome.failureReason.includes('WRITE_FAILED'));
});

test('retry after a write failure succeeds cleanly on a working sink -- no leftover state blocks it', async () => {
  const manifest = buildManifest();
  const brokenSink = {
    async write() {
      throw new Error('temporary failure');
    },
  };
  const first = await runExport(manifest, Buffer.from('plaintext-payload'), createTestOnlyExportEncryptor(), brokenSink);
  assert.equal(first.kind, 'FAILED');

  const workingSink = inMemorySink();
  const retry = await runExport(manifest, Buffer.from('plaintext-payload'), createTestOnlyExportEncryptor(), workingSink);
  assert.equal(retry.kind, 'COMPLETED');
  assert.equal(workingSink.writes.length, 1);
});

test('cancel before encryption starts short-circuits with CANCELLED, no encryption or write attempted', async () => {
  const manifest = buildManifest();
  const sink = inMemorySink();
  let encryptCalls = 0;
  const countingEncryptor = {
    async encrypt(m, d) {
      encryptCalls += 1;
      return createTestOnlyExportEncryptor().encrypt(m, d);
    },
  };
  const outcome = await runExport(manifest, Buffer.from('plaintext-payload'), countingEncryptor, sink, { isCancelled: () => true });
  assert.equal(outcome.kind, 'CANCELLED');
  assert.equal(encryptCalls, 0);
  assert.equal(sink.writes.length, 0);
});

test('cancel after encryption but before write still prevents the write -- no artifact reaches the sink', async () => {
  const manifest = buildManifest();
  const sink = inMemorySink();
  let checkCount = 0;
  const cancelAfterEncrypt = () => {
    checkCount += 1;
    return checkCount > 1; // false on the pre-encryption check, true on the post-encryption check
  };
  const outcome = await runExport(manifest, Buffer.from('plaintext-payload'), createTestOnlyExportEncryptor(), sink, {
    isCancelled: cancelAfterEncrypt,
  });
  assert.equal(outcome.kind, 'CANCELLED');
  assert.equal(sink.writes.length, 0);
});

// ---- privacy ----

test('no server-readable plaintext: the only bytes ever passed to the sink are ciphertext from the encryptor', async () => {
  const manifest = buildManifest();
  const sink = inMemorySink();
  await runExport(manifest, Buffer.from('super-secret-family-activity'), createTestOnlyExportEncryptor(), sink);
  const writtenText = sink.writes[0].ciphertext.toString('utf8');
  assert.ok(writtenText.startsWith('TEST-ONLY-CIPHERTEXT:'), 'sink only ever receives the encryptor output, never a raw plaintext branch');
});
