import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { DeviceSignatureVerifier } from '../../deviceauth/DeviceSignatureVerifier.js';
import { createRateLimiter } from '../rateLimit.js';
import { MySqlDevicePolicyApplicationProofStore } from '../../devicepolicyproof/MySqlDevicePolicyApplicationProofStore.js';
import { canonicalizeDevicePolicyApplicationProof, type DevicePolicyApplicationProofTranscript } from '../../devicepolicyproof/protocol.js';

const BODY_LIMIT = 16 * 1024;
const MAX_FAILED_PER_DEVICE = 5;
const DEVICE_WINDOW_MS = 10 * 60_000;
const GENERIC_FAILURE = { error: 'activation_unavailable' } as const;

export interface DevicePolicyActivationRoutesDeps {
  proofStore: MySqlDevicePolicyApplicationProofStore;
  signatureVerifier: DeviceSignatureVerifier;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  /** Optional device bearer verification. When supplied, any bearer must match claimed family/device. */
  deviceSessionService?: DeviceSessionService;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

async function privateNoStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'private, no-store');
}

function hasDuplicateTopLevelJsonMemberNames(json: string): boolean {
  let index = 0;
  const ws = () => { while (index < json.length && /[\t\n\r ]/.test(json[index]!)) index += 1; };
  const string = (): string | null => {
    if (json[index] !== '"') return null;
    const start = index++;
    while (index < json.length) {
      if (json[index] === '\\') { index += 2; continue; }
      if (json[index] === '"') return JSON.parse(json.slice(start, ++index)) as string;
      index += 1;
    }
    return null;
  };
  const value = () => {
    let objects = 0; let arrays = 0; let inString = false; let escaped = false;
    while (index < json.length) {
      const char = json[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') objects += 1;
      else if (char === '[') arrays += 1;
      else if (char === '}') { if (objects === 0 && arrays === 0) return; objects -= 1; }
      else if (char === ']') arrays -= 1;
      else if (char === ',' && objects === 0 && arrays === 0) return;
      index += 1;
    }
  };
  ws();
  if (json[index++] !== '{') return false;
  const names = new Set<string>();
  while (index < json.length) {
    ws();
    if (json[index] === '}') return false;
    const name = string();
    if (name === null || names.has(name)) return name !== null;
    names.add(name); ws();
    if (json[index++] !== ':') return false;
    ws(); value(); ws();
    if (json[index] === ',') { index += 1; continue; }
    return false;
  }
  return false;
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 4096) return null;
  return header.slice(7);
}

/** Narrow PAIRED activation bootstrap; no ACTIVE session is minted here. */
export function registerDevicePolicyActivationRoutes(app: FastifyInstance, deps: DevicePolicyActivationRoutesDeps): void {
  const ipLimiter = deps.rateLimiter({ windowMs: DEVICE_WINDOW_MS, max: 30, bucket: 'device-policy-activation-ip' });
  const failures = new Map<string, { count: number; resetAt: number }>();
  const duplicateRequests = new WeakSet<FastifyRequest>();
  const inspectRawBody = async (request: FastifyRequest, _reply: FastifyReply, payload: AsyncIterable<Buffer | string>): Promise<AsyncIterable<Buffer>> => {
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of payload) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += bytes.length;
      if (received > BODY_LIMIT) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
      chunks.push(Buffer.from(bytes));
    }
    let raw = Buffer.concat(chunks);
    if (hasDuplicateTopLevelJsonMemberNames(raw.toString('utf8'))) {
      duplicateRequests.add(request);
      raw = Buffer.from('{}');
    }
    const replay = Readable.from([raw]);
    (replay as typeof replay & { receivedEncodedLength?: number }).receivedEncodedLength = received;
    return replay;
  };
  const exactBodyKeys = (request: FastifyRequest, body: unknown, keys: readonly string[]): body is Record<string, unknown> =>
    !duplicateRequests.has(request) && isObject(body) && Object.keys(body).length === keys.length && Object.keys(body).every((key) => keys.includes(key));
  const failedProofLimiter = (deviceId: string): boolean => {
    const now = Date.now();
    // Device identifiers are globally unique UUIDs; never let a caller reset
    // this claimed-device bucket by varying the claimed family.
    const key = deviceId;
    let state = failures.get(key);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + DEVICE_WINDOW_MS };
      failures.set(key, state);
      if (failures.size > 10_000) {
        for (const [oldKey, old] of failures) if (old.resetAt <= now) failures.delete(oldKey);
      }
    }
    state.count += 1;
    return state.count > MAX_FAILED_PER_DEVICE;
  };

  app.post('/v1/device-policy-activation/bootstrap/challenge', {
    bodyLimit: BODY_LIMIT, preParsing: inspectRawBody, onRequest: privateNoStore, preHandler: [ipLimiter],
  }, async (request, reply) => {
    const body = request.body;
    if (!exactBodyKeys(request, body, ['familyId', 'deviceId']) || !isUuid(body.familyId) || !isUuid(body.deviceId)) return reply.code(400).send({ error: 'invalid_request' });
    const token = bearer(request);
    if (token && deps.deviceSessionService) {
      try {
        const identity = await deps.deviceSessionService.validateSession(token);
        if (identity.familyId !== body.familyId || identity.deviceId !== body.deviceId) return reply.code(404).send(GENERIC_FAILURE);
      } catch (error) {
        if (error instanceof RuntimeSyncAuthError) return reply.code(404).send(GENERIC_FAILURE);
        throw error;
      }
    }
    const challenge = await deps.proofStore.issueBootstrapPossessionChallenge(body.familyId, body.deviceId);
    return reply.code(200).send(challenge);
  });

  app.post('/v1/device-policy-activation/bootstrap/complete', {
    bodyLimit: BODY_LIMIT, preParsing: inspectRawBody, onRequest: privateNoStore, preHandler: [ipLimiter],
  }, async (request, reply) => {
    const body = request.body;
    if (!exactBodyKeys(request, body, ['familyId', 'deviceId', 'challengeId', 'nonce', 'signature']) || !isUuid(body.familyId) || !isUuid(body.deviceId) || !isUuid(body.challengeId) ||
        typeof body.nonce !== 'string' || typeof body.signature !== 'string' || body.nonce.length > 64 || body.signature.length > 128) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const token = bearer(request);
    if (token && deps.deviceSessionService) {
      try {
        const identity = await deps.deviceSessionService.validateSession(token);
        if (identity.familyId !== body.familyId || identity.deviceId !== body.deviceId) {
          const limited = failedProofLimiter(body.deviceId);
          return reply.code(limited ? 429 : 404).send(limited ? { error: 'rate_limited' } : GENERIC_FAILURE);
        }
      } catch (error) {
        if (error instanceof RuntimeSyncAuthError) {
          const limited = failedProofLimiter(body.deviceId);
          return reply.code(limited ? 429 : 404).send(limited ? { error: 'rate_limited' } : GENERIC_FAILURE);
        }
        throw error;
      }
    }
    const result = await deps.proofStore.completeBootstrapPossession({
      familyId: body.familyId, deviceId: body.deviceId, challengeId: body.challengeId,
      nonce: body.nonce, signature: body.signature, signatureVerifier: deps.signatureVerifier,
    });
    if (!result) {
      const limited = failedProofLimiter(body.deviceId);
      return reply.code(limited ? 429 : 404).send(limited ? { error: 'rate_limited' } : GENERIC_FAILURE);
    }
    return reply.code(200).send({
      challengeId: result.challengeId, nonce: result.nonce, expiresAt: result.expiresAt.toISOString(),
      activationCapability: result.capability, policyEnvelopeMessageId: result.messageId,
      policyEnvelopeSha256: result.envelopeSha256, trustSetEpoch: result.trustSetEpoch, keyEpoch: result.keyEpoch,
    });
  });

  app.post('/v1/device-policy-activation/bootstrap/fetch', {
    bodyLimit: BODY_LIMIT, preParsing: inspectRawBody, onRequest: privateNoStore, preHandler: [ipLimiter],
  }, async (request, reply) => {
    const body = request.body;
    if (!exactBodyKeys(request, body, ['familyId', 'deviceId', 'activationCapability']) || !isUuid(body.familyId) || !isUuid(body.deviceId) || typeof body.activationCapability !== 'string' ||
        body.activationCapability.length > 64) return reply.code(400).send({ error: 'invalid_request' });
    const token = bearer(request);
    if (token && deps.deviceSessionService) {
      try {
        const identity = await deps.deviceSessionService.validateSession(token);
        if (identity.familyId !== body.familyId || identity.deviceId !== body.deviceId) return reply.code(404).send(GENERIC_FAILURE);
      } catch (error) {
        if (error instanceof RuntimeSyncAuthError) return reply.code(404).send(GENERIC_FAILURE);
        throw error;
      }
    }
    const result = await deps.proofStore.fetchActivationTarget(body.familyId, body.deviceId, body.activationCapability);
    if (!result) return reply.code(404).send(GENERIC_FAILURE);
    return reply.code(200).send({
      challengeId: result.challengeId, policyEnvelopeMessageId: result.messageId,
      policyEnvelopeSha256: result.envelopeSha256, canonicalEnvelopeBytes: result.canonicalEnvelopeBytes.toString('base64url'),
      envelopeSignature: result.envelopeSignature.toString('base64url'), trustSetEpoch: result.trustSetEpoch,
      keyEpoch: result.keyEpoch,
    });
  });

  app.post('/v1/device-policy-activation/proof', {
    bodyLimit: BODY_LIMIT, preParsing: inspectRawBody, onRequest: privateNoStore, preHandler: [ipLimiter],
  }, async (request, reply) => {
    const body = request.body;
    const proofKeys = ['familyId', 'deviceId', 'policyEnvelopeMessageId', 'policyEnvelopeSha256', 'trustSetEpoch', 'keyEpoch', 'applicationResult', 'challengeId', 'challengeNonce', 'challengeExpiresAt', 'signature'];
    if (!exactBodyKeys(request, body, proofKeys) || typeof body.signature !== 'string' || body.signature.length > 128) return reply.code(400).send({ error: 'invalid_request' });
    const { signature, ...candidate } = body;
    try { canonicalizeDevicePolicyApplicationProof(candidate as unknown as DevicePolicyApplicationProofTranscript); }
    catch { return reply.code(400).send({ error: 'invalid_request' }); }
    const transcript = candidate as unknown as DevicePolicyApplicationProofTranscript;
    const token = bearer(request);
    if (token && deps.deviceSessionService) {
      try {
        const identity = await deps.deviceSessionService.validateSession(token);
        if (identity.familyId !== transcript.familyId || identity.deviceId !== transcript.deviceId) return reply.code(404).send(GENERIC_FAILURE);
      } catch (error) {
        if (error instanceof RuntimeSyncAuthError) return reply.code(404).send(GENERIC_FAILURE);
        throw error;
      }
    }
    const result = await deps.proofStore.submitSignedProof(transcript, signature, deps.signatureVerifier);
    if (result.outcome === 'CONFLICT' || result.outcome === 'REJECTED') {
      const limited = failedProofLimiter(transcript.deviceId);
      return reply.code(limited ? 429 : result.outcome === 'CONFLICT' ? 409 : 404)
        .send(limited ? { error: 'rate_limited' } : result.outcome === 'CONFLICT' ? { error: 'proof_conflict' } : GENERIC_FAILURE);
    }
    return reply.code(200).send({ outcome: result.outcome, idempotent: 'idempotent' in result && result.idempotent });
  });

  app.post('/v1/device-policy-activation/proof/status', {
    bodyLimit: 2 * 1024, preParsing: inspectRawBody, onRequest: privateNoStore, preHandler: [ipLimiter],
  }, async (request, reply) => {
    const body = request.body;
    if (!exactBodyKeys(request, body, ['challengeId', 'exactRequestSha256']) || !isUuid(body.challengeId) || typeof body.exactRequestSha256 !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(body.exactRequestSha256)) return reply.code(400).send({ error: 'invalid_request' });
    const status = await deps.proofStore.recoverExactProof(body.challengeId, body.exactRequestSha256);
    if (!status) return reply.code(404).send(GENERIC_FAILURE);
    return reply.code(200).send({ outcome: status.outcome, idempotent: true });
  });
}
