// PCA-FR-137: "Routing metadata... Needed for operability; explicitly
// bounded to exclude anything payload-derived" (doc 09 Security/Privacy
// Section, doc 05). Prior verification of this ID only inspected the
// RelayEnvelopeRecord DB schema shape (ciphertext-blind columns). That
// leaves a real gap: a logging MISCONFIGURATION could still leak payload
// fields (ciphertext, ids treated as free text, request bodies) even
// though the schema itself never grows a plaintext column.
//
// This test verifies the actual PRODUCTION logging configuration, not
// just the schema:
//   1. buildServer() constructs Fastify with `logger: false` -- verified
//      both by reading the exact production wiring source text (so a
//      future edit that flips this default is caught) and, empirically,
//      by proving Fastify's own logger never writes to stdout/stderr.
//   2. A full relay/runtime-sync HTTP flow (challenge -> session ->
//      outbound submit with ciphertext -> inbound fetch -> ack), including
//      several error paths (unauthenticated, cross-family, malformed,
//      unknown message id), is driven through the real route handlers
//      while stdout/stderr writes are captured. The captured output must
//      never contain the ciphertext bytes, the base64 ciphertext, or any
//      other request-body-derived payload content.
//   3. No source file under the modules that ever see relay/envelope
//      ciphertext (relay, runtime-sync, familyenvelope, http/routes)
//      contains a `console.*` or Fastify `.log.*` call at all -- so there
//      is no logging call site left that COULD leak a payload field, now
//      or after a future edit that forgets to keep it sanitized.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildServer } from '../../dist/http/buildServer.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { EnrollmentCoordinator } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import { RelayService } from '../../dist/relay/RelayService.js';
import { SyncCoordinator } from '../../dist/familysync/SyncCoordinator.js';
import { InMemoryPendingQueueStore } from '../../dist/familysync/InMemoryPendingQueueStore.js';
import { InMemorySequenceProgressLedger } from '../../dist/familysync/InMemorySequenceProgressLedger.js';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';
import {
  DeviceSessionService,
  InMemoryDeviceSessionRepository,
  OutboundRelayService,
  InboundReconnectService,
  DeviceSyncStatusTracker,
} from '../../dist/runtime-sync/index.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { createInMemoryInvitationRepository } from '../support/inMemoryInvitationRepository.mjs';
import { createInMemoryEnrollmentRepository } from '../support/inMemoryEnrollmentRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';
import { createInMemoryDeviceChallengeRepository } from '../support/inMemoryDeviceChallengeRepository.mjs';
import { createTestOnlyDeviceSignatureVerifier, signTestOnlyChallenge } from '../support/testOnlyDeviceSignatureVerifier.mjs';
import { createTestOnlyEnvelopeSignatureVerifier } from '../support/testOnlyEnvelopeSignatureVerifier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

function buildApp() {
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository());
  const deviceAuthService = new DeviceAuthService(
    createInMemoryDeviceChallengeRepository(),
    deviceRepository,
    createTestOnlyDeviceSignatureVerifier(),
  );
  const deviceSessionService = new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository());
  const outboundRelayService = new OutboundRelayService(relayService, deviceRepository);
  const syncCoordinator = new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new InMemorySequenceProgressLedger(),
    new InMemoryReplayLedger(),
    new InMemoryDataVersionLedger(),
    new InMemoryMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: () => false },
  );
  const inboundReconnectService = new InboundReconnectService(relayService, syncCoordinator);
  const statusTracker = new DeviceSyncStatusTracker();

  const app = buildServer({
    authService: new AuthService(createInMemoryAuthRepository()),
    authzService: new AuthzService(createInMemoryAuthzRepository()),
    invitationService: new InvitationService(createInMemoryInvitationRepository()),
    enrollmentCoordinator: new EnrollmentCoordinator(createInMemoryEnrollmentRepository()),
    pairingService: new PairingService(deviceRepository),
    deviceSessionService,
    outboundRelayService,
    inboundReconnectService,
    statusTracker,
    resolveEnvelopeContext: (_senderKeyId, familyId, nowUtc) => ({
      senderPublicKey: '',
      minimumAcceptedTrustSetEpoch: 0,
      minimumAcceptedKeyEpoch: 0,
      familyId,
      now: nowUtc,
    }),
  });
  return { app, deviceRepository };
}

async function registerDevice(deviceRepository, familyId) {
  const deviceId = `device-${randomUUID()}`;
  const publicKey = `pubkey-${randomUUID()}`;
  await deviceRepository.createDeviceWithKey(
    { deviceId, familyId, platform: 'ANDROID', status: 'ACTIVE', createdAt: new Date(), revokedAt: null, pairedAt: null, pairedByAccountId: null },
    { deviceId, keyId: `key-${randomUUID()}`, keyPurpose: 'DSK', publicKey, status: 'ACTIVE', createdAt: new Date(), revokedAt: null },
  );
  return { deviceId, publicKey };
}

async function authenticateDevice(app, deviceId, publicKey) {
  const challengeResponse = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/${deviceId}/challenge` });
  assert.equal(challengeResponse.statusCode, 200);
  const { challengeId, nonce } = challengeResponse.json();
  const signature = signTestOnlyChallenge(publicKey, nonce);
  const sessionResponse = await app.inject({
    method: 'POST',
    url: `/v1/runtime-sync/devices/${deviceId}/session`,
    payload: { challengeId, signature },
  });
  assert.equal(sessionResponse.statusCode, 200);
  return sessionResponse.json().sessionToken;
}

/**
 * Captures a COPY of every byte written to stdout/stderr for the duration
 * of `fn`, while still forwarding every write to the real stream. This
 * must forward (not swallow) writes: node's own `--test` TAP reporter
 * writes its `ok`/`not ok`/test-event protocol lines through
 * process.stdout.write concurrently with async test bodies, so swallowing
 * would corrupt the test runner's own output/bookkeeping. Because that
 * reporter traffic is unavoidably captured alongside anything the app
 * writes, callers must assert on ABSENCE of a specific payload marker
 * within the capture, never on the capture being empty.
 */
async function captureStdio(fn) {
  const chunks = [];
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  const wrap = (real) => (chunk, ...rest) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return real(chunk, ...rest);
  };
  process.stdout.write = wrap(realStdoutWrite);
  process.stderr.write = wrap(realStderrWrite);
  try {
    await fn();
  } finally {
    process.stdout.write = realStdoutWrite;
    process.stderr.write = realStderrWrite;
  }
  return chunks.join('');
}

test('buildServer.ts constructs Fastify with logger disabled (source-level regression guard)', () => {
  const source = readFileSync(path.join(BACKEND_ROOT, 'src', 'http', 'buildServer.ts'), 'utf8');
  assert.match(
    source,
    /Fastify\(\s*\{\s*logger:\s*false\s*\}\s*\)/,
    'buildServer.ts must construct Fastify with logger explicitly disabled -- Fastify\'s default pino logger would otherwise emit per-request access logs (method/url/headers) to stdout in production, which is a payload-adjacent leak surface independent of the relay DB schema.',
  );
});

test('Fastify logger is a real no-op at runtime: app.log.info never writes to stdout even when called directly', async () => {
  const { app } = buildApp();
  try {
    const output = await captureStdio(async () => {
      app.log.info({ ciphertext: 'MARKER_SHOULD_NEVER_BE_WRITTEN' }, 'this must never reach stdout');
      app.log.error({ ciphertext: 'MARKER_SHOULD_NEVER_BE_WRITTEN' }, 'neither must this');
    });
    assert.equal(
      output.includes('MARKER_SHOULD_NEVER_BE_WRITTEN'),
      false,
      'logger:false must make app.log a true no-op -- a direct app.log.info/error call must never reach stdout/stderr',
    );
  } finally {
    await app.close();
  }
});

test('a full relay/runtime-sync HTTP flow (success + error paths) never writes ciphertext or request-body content to stdout/stderr', async () => {
  const { app, deviceRepository } = buildApp();
  const marker = `CIPHERTEXT_MARKER_${randomUUID()}`;
  const ciphertextB64 = Buffer.from(marker, 'utf8').toString('base64');
  try {
    const output = await captureStdio(async () => {
      const familyId = `family-${randomUUID()}`;
      const { deviceId: senderId, publicKey } = await registerDevice(deviceRepository, familyId);
      const { deviceId: recipientId, publicKey: recipientPublicKey } = await registerDevice(deviceRepository, familyId);
      const { deviceId: outsiderId } = await registerDevice(deviceRepository, `family-${randomUUID()}`);
      const token = await authenticateDevice(app, senderId, publicKey);

      // Success path: queue a real envelope carrying the marker ciphertext.
      const submit = await app.inject({
        method: 'POST',
        url: '/v1/runtime-sync/outbound',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: [{ messageId: 'm1', recipientDeviceId: recipientId, ciphertext: ciphertextB64, messageType: 'STATUS_SNAPSHOT' }] },
      });
      assert.equal(submit.statusCode, 200);

      // Error path: cross-family recipient (still carries the marker in the request body).
      await app.inject({
        method: 'POST',
        url: '/v1/runtime-sync/outbound',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: [{ messageId: 'm2', recipientDeviceId: outsiderId, ciphertext: ciphertextB64, messageType: 'STATUS_SNAPSHOT' }] },
      });

      // Error path: unauthenticated.
      await app.inject({
        method: 'POST',
        url: '/v1/runtime-sync/outbound',
        payload: { items: [{ messageId: 'm3', recipientDeviceId: recipientId, ciphertext: ciphertextB64, messageType: 'STATUS_SNAPSHOT' }] },
      });

      // Error path: malformed body (still contains the marker somewhere Fastify's body parser sees it).
      await app.inject({
        method: 'POST',
        url: '/v1/runtime-sync/outbound',
        headers: { authorization: `Bearer ${token}` },
        payload: { items: 'not-an-array', marker },
      });

      // Recipient fetches inbound (the marker ciphertext flows through the response body, not just the request).
      const recipientToken = await authenticateDevice(app, recipientId, recipientPublicKey);
      const inbound = await app.inject({
        method: 'GET',
        url: '/v1/runtime-sync/inbound',
        headers: { authorization: `Bearer ${recipientToken}` },
      });
      assert.equal(inbound.statusCode, 200);

      // Error path: ack of an unknown message id.
      await app.inject({
        method: 'POST',
        url: '/v1/runtime-sync/inbound/nonexistent-message-id/ack',
        headers: { authorization: `Bearer ${recipientToken}` },
      });
    });

    assert.equal(output.includes(marker), false, 'the ciphertext plaintext marker must never appear in process output');
    assert.equal(output.includes(ciphertextB64), false, 'the base64-encoded ciphertext must never appear in process output');
  } finally {
    await app.close();
  }
});

/** Recursively lists every .ts file under `dir`, skipping test/dist/node_modules directories. */
function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('no source file in the modules that see relay/envelope ciphertext contains a console.* or Fastify request-logger call', () => {
  const dirsToScan = [
    path.join(BACKEND_ROOT, 'src', 'relay'),
    path.join(BACKEND_ROOT, 'src', 'runtime-sync'),
    path.join(BACKEND_ROOT, 'src', 'familyenvelope'),
    path.join(BACKEND_ROOT, 'src', 'http', 'routes'),
  ];
  const loggingCallPattern = /console\.(log|error|warn|info|debug)\s*\(|\b(app|request|reply|req|fastify)\.log\.(info|error|warn|debug|trace|fatal)\s*\(/;
  const offenders = [];
  for (const dir of dirsToScan) {
    for (const file of listTsFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      if (loggingCallPattern.test(source)) offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `found logging call sites in relay/envelope-adjacent source that could leak payload fields: ${offenders.join(', ')}`,
  );
});
