// WAVE 6B — HTTP surface for the first-device bootstrap ceremony
// (dist/http/routes/firstDeviceBootstrapRoutes.js) on a bare Fastify app
// with scripted services: wire vocabulary, bounds, H12 server-authoritative
// context, per-route rate-limit buckets, the parent session/CSRF/step-up
// ordering (PCA-STEPUP-ORDER-1), owner-only approval discovery, and the
// privacy-minimal M1 fingerprint DTO.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { registerFirstDeviceBootstrapRoutes } from '../../dist/http/routes/firstDeviceBootstrapRoutes.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { csrfCookieName, sessionCookieName } from '../../dist/parentaccount/cookies.js';
import { computeKeyFingerprint } from '../../dist/pairing/fingerprint.js';
import { makeP256Device } from './firstDeviceBootstrapFixtures.mjs';

const FAMILY = 'family-bootstrap-routes';
const OTHER_FAMILY = 'family-bootstrap-routes-other';
const ATTEMPT_ID = 'a'.repeat(32);
const RECOVERY_TOKEN = 'r'.repeat(43);
const CEREMONY_ID = 'c'.repeat(36);
const STEP_UP_TOKEN = 'step-up-token-1';
const SS_DEVICE = makeP256Device('routes-detail');

// Cookie names come from the SAME authority the route reads them from, so
// this file cannot drift when the __Host- production prefix applies (that
// prefix is active whenever NODE_ENV is not exactly 'test'/'development').
const SESSION_COOKIE = sessionCookieName();
const CSRF_COOKIE = csrfCookieName();
const sessionHeaders = (token) => ({ cookie: `${SESSION_COOKIE}=${token}` });

const SESSIONS = new Map([
  ['session-owner', { accountId: 'acct-owner', familyId: FAMILY }],
  ['session-no-family', { accountId: 'acct-no-family', familyId: null }],
  ['session-other', { accountId: 'acct-other', familyId: OTHER_FAMILY }],
]);

function ceremonyRecord(overrides = {}) {
  return {
    ceremonyId: CEREMONY_ID,
    familyId: FAMILY,
    deviceId: SS_DEVICE.deviceId,
    dskKeyId: SS_DEVICE.dskKeyId,
    dskPublicKey: SS_DEVICE.dskPublicKey,
    dskAlgorithm: 'ECDSA_P256_SHA256',
    purpose: 'PCA_FIRST_DEVICE_BOOTSTRAP_V1',
    challengeId: randomUUID(),
    nonce: 'n'.repeat(43),
    expiresAt: new Date('2099-10-02T00:10:00.000Z'),
    status: 'PENDING',
    approvedByAccountId: null,
    approvedAt: null,
    payloadDigest: null,
    outcome: null,
    consumedAt: null,
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    ...overrides,
  };
}

function buildApp(options = {}) {
  const {
    role = 'ADMINISTRATOR',
    stepUpAccepted = true,
    eligibility = true,
    ceremony = null,
    challengeOutcome = { status: 'UNAVAILABLE' },
    submitOutcome = { status: 'UNAVAILABLE' },
    statusOutcome = { status: 'UNAVAILABLE' },
    approveOutcome = { status: 'NOT_FOUND' },
  } = options;

  const consumeCalls = [];
  const parentAccountService = {
    async readSession(token) {
      const session = SESSIONS.get(token);
      if (!session) throw new ParentAccountError('UNAUTHORIZED');
      return session;
    },
    async activeFamilyRole() {
      return role;
    },
    async consumeSensitiveStepUpForSession(sessionToken, familyId, operation, stepUpToken) {
      consumeCalls.push({ sessionToken, familyId, operation, stepUpToken });
      return stepUpAccepted;
    },
  };

  const serviceCalls = { challenge: [], submit: [], status: [], approve: [], describe: [], list: [] };
  const bootstrapService = {
    async issueChallenge(input) {
      serviceCalls.challenge.push(input);
      if (challengeOutcome.status !== 'PENDING') return challengeOutcome;
      return {
        status: 'PENDING',
        ceremonyId: CEREMONY_ID,
        challengeId: randomUUID(),
        nonce: 'n'.repeat(43),
        expiresAt: '2026-10-02T00:10:00.000Z',
        familyId: FAMILY,
        deviceId: SS_DEVICE.deviceId,
      };
    },
    async submit(input) {
      serviceCalls.submit.push(input);
      return submitOutcome;
    },
    async readStatus(input) {
      serviceCalls.status.push(input);
      return statusOutcome;
    },
    async describeForApproval(familyId, ceremonyId) {
      serviceCalls.describe.push({ familyId, ceremonyId });
      if (ceremony === null || ceremony.familyId !== familyId || ceremony.ceremonyId !== ceremonyId) return null;
      return ceremony;
    },
    async checkApprovalEligibility() {
      return eligibility;
    },
    async listForApproval(familyId, accountId) {
      serviceCalls.list.push({ familyId, accountId });
      if (!eligibility) return null;
      return ceremony && ceremony.familyId === familyId ? [ceremony] : [];
    },
    async approve(input) {
      serviceCalls.approve.push(input);
      if (approveOutcome.status === 'APPROVED') {
        return { status: 'APPROVED', ceremony: ceremony ?? ceremonyRecord({ status: 'APPROVED' }) };
      }
      return approveOutcome;
    },
  };

  const app = Fastify();
  registerFirstDeviceBootstrapRoutes(app, { parentAccountService, bootstrapService, rateLimiter: createRateLimiter() });
  return { app, consumeCalls, serviceCalls };
}

const challengeBody = () => ({ attemptId: ATTEMPT_ID, attemptRecoveryToken: RECOVERY_TOKEN, dskKeyId: SS_DEVICE.dskKeyId, dskPublicKey: SS_DEVICE.dskPublicKey });
const submitBody = () => ({
  attemptId: ATTEMPT_ID,
  attemptRecoveryToken: RECOVERY_TOKEN,
  ceremonyId: CEREMONY_ID,
  proofBytes: '13:proof-bytes',
  proofSignature: 'signature-1',
  epoch1Bytes: '24:epoch-bytes',
  epoch1Signature: 'signature-2',
  attestationEvidence: null,
});
const parentHeaders = { cookie: `${SESSION_COOKIE}=session-owner; ${CSRF_COOKIE}=csrf-1`, 'x-pca-csrf-token': 'csrf-1' };

test('challenge: bounded invalid bodies get 400; UNAVAILABLE collapses to one 404 vocabulary; success carries server-authoritative familyId/deviceId (H12)', async () => {
  const unavailable = buildApp();
  try {
    const invalid = await unavailable.app.inject({
      method: 'POST',
      url: '/v1/first-device-bootstrap/challenge',
      payload: { ...challengeBody(), attemptId: 'short' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, 'invalid_request');

    const notFound = await unavailable.app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/challenge', payload: challengeBody() });
    assert.equal(notFound.statusCode, 404);
    assert.deepEqual(notFound.json(), { error: 'ceremony_unavailable' });
  } finally {
    await unavailable.app.close();
  }

  const success = buildApp({ challengeOutcome: { status: 'PENDING' } });
  try {
    const response = await success.app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/challenge', payload: challengeBody() });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'PENDING');
    assert.equal(body.familyId, FAMILY);
    assert.equal(body.deviceId, SS_DEVICE.deviceId);
    assert.equal(body.ceremonyId, CEREMONY_ID);
    assert.equal(body.nonce.length, 43);
    assert.equal(success.serviceCalls.challenge.length, 1);
  } finally {
    await success.app.close();
  }
});

test('every device route owns a rate-limit bucket: the 31st challenge request in a window is throttled', async () => {
  const { app } = buildApp();
  try {
    for (let index = 0; index < 30; index += 1) {
      const response = await app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/challenge', payload: { ...challengeBody(), attemptId: 'short' } });
      assert.equal(response.statusCode, 400, `request ${index} must pass the limiter and fail validation`);
    }
    const throttled = await app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/challenge', payload: { ...challengeBody(), attemptId: 'short' } });
    assert.equal(throttled.statusCode, 429);
  } finally {
    await app.close();
  }
});

test('submit: ACCEPTED → 200, REJECTED → 409 bootstrap_rejected, UNAVAILABLE → 404 ceremony_unavailable; a missing evidence field becomes null', async () => {
  const accepted = buildApp({ submitOutcome: { status: 'ACCEPTED' } });
  try {
    const response = await accepted.app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/submit', payload: submitBody() });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ACCEPTED' });
    assert.equal(accepted.serviceCalls.submit[0].attestationEvidence, null, 'JSON omission must pass an explicit null to the service');
  } finally {
    await accepted.app.close();
  }

  const rejected = buildApp({ submitOutcome: { status: 'REJECTED' } });
  try {
    const response = await rejected.app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/submit', payload: submitBody() });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'bootstrap_rejected' });
  } finally {
    await rejected.app.close();
  }

  const unavailable = buildApp();
  try {
    const response = await unavailable.app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/submit', payload: submitBody() });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'ceremony_unavailable' });

    const invalid = await unavailable.app.inject({ method: 'POST', url: '/v1/first-device-bootstrap/submit', payload: { ...submitBody(), proofBytes: '' } });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await unavailable.app.close();
  }
});

test('submit accepts a large-but-bounded payload (H5: 320 KiB body limit) and rejects one beyond it with 413', async () => {
  const { app } = buildApp({ submitOutcome: { status: 'ACCEPTED' } });
  try {
    const large = await app.inject({
      method: 'POST',
      url: '/v1/first-device-bootstrap/submit',
      payload: { ...submitBody(), proofBytes: 'A'.repeat(64 * 1024) },
    });
    assert.equal(large.statusCode, 200, 'a 64 KiB proof must not be cut off at the old 8 KiB body limit');

    const oversize = await app.inject({
      method: 'POST',
      url: '/v1/first-device-bootstrap/submit',
      payload: { ...submitBody(), proofBytes: 'A'.repeat(321 * 1024) },
    });
    assert.equal(oversize.statusCode, 413, 'beyond 320 KiB the transport must refuse the body');
  } finally {
    await app.close();
  }
});

test('status: exposes the stable state/outcome pair or the same one 404 vocabulary', async () => {
  const committed = buildApp({ statusOutcome: { status: 'COMMITTED', outcome: 'ACCEPTED' } });
  try {
    const response = await committed.app.inject({
      method: 'POST',
      url: '/v1/first-device-bootstrap/status',
      payload: { attemptId: ATTEMPT_ID, attemptRecoveryToken: RECOVERY_TOKEN, ceremonyId: CEREMONY_ID },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'COMMITTED', outcome: 'ACCEPTED' });
  } finally {
    await committed.app.close();
  }

  const unavailable = buildApp();
  try {
    const response = await unavailable.app.inject({
      method: 'POST',
      url: '/v1/first-device-bootstrap/status',
      payload: { attemptId: ATTEMPT_ID, attemptRecoveryToken: RECOVERY_TOKEN, ceremonyId: CEREMONY_ID },
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'ceremony_unavailable' });
  } finally {
    await unavailable.app.close();
  }
});

test('parent list and detail: session, family scope, active ADMINISTRATOR and provisioned-owner eligibility are required; DTO contains only comparison metadata', async () => {
  const { app } = buildApp({ ceremony: ceremonyRecord() });
  try {
    const listUrl = `/api/parent/families/${FAMILY}/first-device-bootstrap`;
    const noListSession = await app.inject({ method: 'GET', url: listUrl });
    assert.equal(noListSession.statusCode, 401);

    const noFamilyList = await app.inject({ method: 'GET', url: listUrl, headers: sessionHeaders('session-no-family') });
    assert.equal(noFamilyList.statusCode, 403);

    const crossFamilyList = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${OTHER_FAMILY}/first-device-bootstrap`,
      headers: sessionHeaders('session-owner'),
    });
    assert.equal(crossFamilyList.statusCode, 403);

    const listed = await app.inject({ method: 'GET', url: listUrl, headers: sessionHeaders('session-owner') });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().ceremonies.length, 1);
    const listedDto = listed.json().ceremonies[0];
    assert.deepEqual(Object.keys(listedDto).sort(), ['approvedAt', 'ceremonyId', 'createdAt', 'deviceId', 'dskFingerprint', 'expiresAt', 'status']);
    assert.equal(listedDto.deviceId, SS_DEVICE.deviceId);
    assert.equal(listedDto.dskFingerprint, computeKeyFingerprint(SS_DEVICE.dskPublicKey));
    assert.equal(listedDto.status, 'PENDING');
    for (const forbidden of ['familyId', 'dskKeyId', 'dskPublicKey', 'nonce', 'challengeId', 'attemptId', 'attemptRecoveryToken', 'attestationEvidence', 'outcome', 'consumedAt']) {
      assert.equal(Object.hasOwn(listedDto, forbidden), false, `response must not expose ${forbidden}`);
    }

    const noSession = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/first-device-bootstrap/${CEREMONY_ID}` });
    assert.equal(noSession.statusCode, 401);

    const noFamilySession = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/first-device-bootstrap/${CEREMONY_ID}`,
      headers: sessionHeaders('session-no-family'),
    });
    assert.equal(noFamilySession.statusCode, 403);
    assert.equal(noFamilySession.json().error, 'family_scope_required');

    const wrongFamily = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${OTHER_FAMILY}/first-device-bootstrap/${CEREMONY_ID}`,
      headers: sessionHeaders('session-owner'),
    });
    assert.equal(wrongFamily.statusCode, 403);
    assert.equal(wrongFamily.json().error, 'family_scope_forbidden');

    const ok = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/first-device-bootstrap/${CEREMONY_ID}`,
      headers: sessionHeaders('session-owner'),
    });
    assert.equal(ok.statusCode, 200);
    const detail = ok.json().ceremony;
    assert.deepEqual(Object.keys(detail).sort(), ['approvedAt', 'ceremonyId', 'createdAt', 'deviceId', 'dskFingerprint', 'expiresAt', 'status']);
    assert.equal(detail.deviceId, SS_DEVICE.deviceId);
    assert.equal(detail.dskFingerprint, computeKeyFingerprint(SS_DEVICE.dskPublicKey));
    assert.equal(detail.status, 'PENDING');

    const missing = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/first-device-bootstrap/${randomUUID()}`,
      headers: sessionHeaders('session-owner'),
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }

  const nonAdmin = buildApp({ role: 'MEMBER', ceremony: ceremonyRecord() });
  try {
    const response = await nonAdmin.app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/first-device-bootstrap/${CEREMONY_ID}`,
      headers: sessionHeaders('session-owner'),
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'forbidden');
  } finally {
    await nonAdmin.app.close();
  }

  const notProvisionedOwner = buildApp({ eligibility: false, ceremony: ceremonyRecord() });
  try {
    const list = await notProvisionedOwner.app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/first-device-bootstrap`,
      headers: sessionHeaders('session-owner'),
    });
    assert.equal(list.statusCode, 403);
    assert.deepEqual(list.json(), { error: 'forbidden' });
    assert.equal(notProvisionedOwner.serviceCalls.list.length, 1);

    const detail = await notProvisionedOwner.app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/first-device-bootstrap/${CEREMONY_ID}`,
      headers: sessionHeaders('session-owner'),
    });
    assert.equal(detail.statusCode, 403);
    assert.deepEqual(detail.json(), { error: 'forbidden' });
    assert.equal(notProvisionedOwner.serviceCalls.describe.length, 0, 'an ineligible administrator must not read ceremony details');
  } finally {
    await notProvisionedOwner.app.close();
  }
});

test('approve enforces CSRF, then ceremony existence/eligibility, and only then consumes the dedicated step-up operation (PCA-STEPUP-ORDER-1)', async () => {
  const approveUrl = `/api/parent/families/${FAMILY}/first-device-bootstrap/approve`;
  const body = { ceremonyId: CEREMONY_ID, stepUpToken: STEP_UP_TOKEN };

  const { app, consumeCalls, serviceCalls } = buildApp({
    ceremony: ceremonyRecord({ status: 'APPROVED' }),
    approveOutcome: { status: 'APPROVED' },
  });
  try {
    const noSession = await app.inject({ method: 'POST', url: approveUrl, payload: body });
    assert.equal(noSession.statusCode, 401);

    const noCsrf = await app.inject({ method: 'POST', url: approveUrl, payload: body, headers: sessionHeaders('session-owner') });
    assert.equal(noCsrf.statusCode, 403);
    assert.equal(noCsrf.json().error, 'csrf_mismatch');

    const missingCeremony = await app.inject({
      method: 'POST',
      url: approveUrl,
      payload: { ceremonyId: randomUUID(), stepUpToken: STEP_UP_TOKEN },
      headers: parentHeaders,
    });
    assert.equal(missingCeremony.statusCode, 404);
    assert.equal(consumeCalls.length, 0, 'a missing ceremony must be rejected before the step-up token is consumed');

    const ok = await app.inject({ method: 'POST', url: approveUrl, payload: body, headers: parentHeaders });
    assert.equal(ok.statusCode, 200);
    const responseBody = ok.json();
    assert.deepEqual(Object.keys(responseBody), ['ceremony']);
    assert.equal(responseBody.ceremony.status, 'APPROVED');
    assert.equal(responseBody.ceremony.deviceId, SS_DEVICE.deviceId);
    assert.equal(responseBody.ceremony.dskFingerprint, computeKeyFingerprint(SS_DEVICE.dskPublicKey));
    assert.deepEqual(Object.keys(responseBody.ceremony).sort(), ['approvedAt', 'ceremonyId', 'createdAt', 'deviceId', 'dskFingerprint', 'expiresAt', 'status']);
    assert.equal(consumeCalls.length, 1);
    assert.deepEqual(consumeCalls[0], {
      sessionToken: 'session-owner',
      familyId: FAMILY,
      operation: 'family.device.bootstrap.root',
      stepUpToken: STEP_UP_TOKEN,
    });
    assert.equal(serviceCalls.approve.length, 1);
  } finally {
    await app.close();
  }

  const ineligible = buildApp({ ceremony: ceremonyRecord(), eligibility: false });
  try {
    const response = await ineligible.app.inject({ method: 'POST', url: approveUrl, payload: body, headers: parentHeaders });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'forbidden');
    assert.equal(ineligible.consumeCalls.length, 0, 'ineligibility is decided before the step-up token is consumed');
  } finally {
    await ineligible.app.close();
  }

  const badStepUp = buildApp({ ceremony: ceremonyRecord(), stepUpAccepted: false });
  try {
    const response = await badStepUp.app.inject({ method: 'POST', url: approveUrl, payload: body, headers: parentHeaders });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'forbidden');
    assert.equal(badStepUp.consumeCalls.length, 1, 'the token IS consumed (and rejected) when everything before it passed');
    assert.equal(badStepUp.serviceCalls.approve.length, 0, 'no approval may occur on a failed step-up');
  } finally {
    await badStepUp.app.close();
  }
});

test('approve maps the service vocabulary: NOT_FOUND → 404, NOT_ELIGIBLE → 403, NOT_APPROVABLE → 409', async () => {
  const approveUrl = `/api/parent/families/${FAMILY}/first-device-bootstrap/approve`;
  const body = { ceremonyId: CEREMONY_ID, stepUpToken: STEP_UP_TOKEN };

  for (const [outcome, expectedStatus, expectedError] of [
    [{ status: 'NOT_FOUND' }, 404, 'not_found'],
    [{ status: 'NOT_ELIGIBLE' }, 403, 'forbidden'],
    [{ status: 'NOT_APPROVABLE' }, 409, 'ceremony_not_approvable'],
  ]) {
    const { app } = buildApp({ ceremony: ceremonyRecord(), approveOutcome: outcome });
    try {
      const response = await app.inject({ method: 'POST', url: approveUrl, payload: body, headers: parentHeaders });
      assert.equal(response.statusCode, expectedStatus, outcome.status);
      assert.equal(response.json().error, expectedError);
    } finally {
      await app.close();
    }
  }
});
