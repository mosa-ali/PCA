import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { registerDevicePolicyActivationRoutes } from '../../dist/http/routes/devicePolicyActivationRoutes.js';

const family = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const device = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const challenge = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const signatureVerifier = { verify: async () => true };

function makeApp(overrides = {}) {
  const app = Fastify();
  const store = {
    issueBootstrapPossessionChallenge: async () => ({ challengeId: challenge, nonce: 'A'.repeat(43), expiresAt: new Date('2026-10-16T00:01:00.000Z') }),
    completeBootstrapPossession: async () => null,
    fetchActivationTarget: async () => null,
    submitSignedProof: async () => ({ outcome: 'REJECTED' }),
    recoverExactProof: async () => null,
    ...overrides,
  };
  registerDevicePolicyActivationRoutes(app, { proofStore: store, signatureVerifier, rateLimiter: createRateLimiter() });
  return app.ready().then(() => ({ app, store }));
}

test('paired PoP failures are non-enumerating and the five-failure bucket cannot be reset by family claims', async () => {
  const { app } = await makeApp();
  try {
    const first = await app.inject({ method: 'POST', url: '/v1/device-policy-activation/bootstrap/complete',
      payload: { familyId: family, deviceId: device, challengeId: challenge, nonce: 'A'.repeat(43), signature: 'bad' } });
    assert.equal(first.statusCode, 404);
    assert.deepEqual(first.json(), { error: 'activation_unavailable' });
    for (let n = 0; n < 4; n += 1) {
      await app.inject({ method: 'POST', url: '/v1/device-policy-activation/bootstrap/complete',
        payload: { familyId: family, deviceId: device, challengeId: challenge, nonce: 'A'.repeat(43), signature: 'bad' } });
    }
    const variedFamily = await app.inject({ method: 'POST', url: '/v1/device-policy-activation/bootstrap/complete',
      payload: { familyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', deviceId: device, challengeId: challenge, nonce: 'A'.repeat(43), signature: 'bad' } });
    assert.equal(variedFamily.statusCode, 429);
    assert.deepEqual(variedFamily.json(), { error: 'rate_limited' });
  } finally { await app.close(); }
});

test('successful PAIRED PoP returns only its bounded target challenge and capability', async () => {
  const { app } = await makeApp({ completeBootstrapPossession: async () => ({
    challengeId: challenge, nonce: 'B'.repeat(43), capability: 'C'.repeat(43),
    expiresAt: new Date('2026-10-16T00:01:00.000Z'), messageId: 'policy-1',
    envelopeSha256: 'D'.repeat(43), trustSetEpoch: 3, keyEpoch: 4,
  }) });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/device-policy-activation/bootstrap/complete',
      payload: { familyId: family, deviceId: device, challengeId: challenge, nonce: 'A'.repeat(43), signature: 'sig' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.json()).sort(), [
      'activationCapability', 'challengeId', 'expiresAt', 'keyEpoch', 'nonce',
      'policyEnvelopeMessageId', 'policyEnvelopeSha256', 'trustSetEpoch',
    ].sort());
    assert.equal(response.json().policyEnvelopeMessageId, 'policy-1');
  } finally { await app.close(); }
});

test('challenge issuance is syntactically valid even for unavailable claims and is marked no-store', async () => {
  const { app } = await makeApp();
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/device-policy-activation/bootstrap/challenge', payload: { familyId: family, deviceId: device } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.json().challengeId, challenge);
  } finally { await app.close(); }
});

test('activation DTOs reject unknown and duplicate top-level JSON members', async () => {
  const { app } = await makeApp();
  try {
    const extra = await app.inject({ method: 'POST', url: '/v1/device-policy-activation/bootstrap/challenge',
      payload: { familyId: family, deviceId: device, extra: 'not-allowed' } });
    assert.equal(extra.statusCode, 400);
    const duplicate = await app.inject({ method: 'POST', url: '/v1/device-policy-activation/bootstrap/challenge',
      headers: { 'content-type': 'application/json' },
      payload: `{"familyId":"${family}","deviceId":"${device}","deviceId":"${device}"}` });
    assert.equal(duplicate.statusCode, 400);
  } finally { await app.close(); }
});
