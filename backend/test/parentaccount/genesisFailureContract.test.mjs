// F-A (Fix A completion) -- hostile HTTP-level tests for the genesis failure
// contract in parentAccountRoutes.ts.
//
// The defect these tests pin down: the production composition wires a
// REJECTING genesis verifier (see main.ts), so ParentGenesisService.complete
// throws GenesisChallengeError('INVALID_SIGNATURE') for every completion --
// and a genuinely dead session throws ParentAccountError('UNAUTHORIZED').
// The route previously answered 401 to BOTH, which the parent-web client
// reported as "your session has expired": false for a session that was fine,
// and it sent the parent to sign in again for a problem signing in cannot fix.
//
// These drive the REAL buildServer() composition (so the shared error
// boundary is the same one production uses) with a stub parentAccountService
// that throws the exact domain errors the real services throw, and assert
// both the status/body a client receives and that no service call happened
// where the route is supposed to fail closed first.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { GenesisChallengeError } from '../../dist/parentaccount/GenesisChallengeService.js';

function noop() {}
async function asyncNoop() {}

const CSRF_COOKIE = 'pca_family_csrf=stub-csrf-value';
const SESSION_COOKIE = 'pca_family_session=stub-session-token';
const AUTHED_HEADERS = { cookie: `${SESSION_COOKIE}; ${CSRF_COOKIE}`, 'x-pca-csrf-token': 'stub-csrf-value' };

/**
 * Stub parentAccountService that records every call and applies per-method
 * behaviour supplied by the test: a returned value (resolution) or a thrown
 * domain error.
 */
function makeStubService(behaviours = {}) {
  const calls = [];
  const method = (name) => async (...args) => {
    calls.push({ name, args });
    const behaviour = behaviours[name];
    if (behaviour === undefined) return undefined;
    return behaviour(...args);
  };
  return {
    calls,
    readSession: method('readSession'),
    requestGenesisStepUp: method('requestGenesisStepUp'),
    completeGenesisStepUp: method('completeGenesisStepUp'),
    beginGenesisChallenge: method('beginGenesisChallenge'),
    completeGenesis: method('completeGenesis'),
  };
}

/**
 * Real buildServer() with lightweight stubs for every dependency. Only
 * parentAccountService and genesisCryptographyAvailable are meaningful here;
 * every other field is never touched by the routes under test. Pattern
 * mirrors buildServer.removalDecisionAndSafeZoneWiring.test.mjs.
 */
function buildApp({ service, genesisCryptographyAvailable }) {
  return buildServer({
    authService: { requireServiceSession: asyncNoop },
    authzService: {},
    authzRepository: {},
    invitationService: {},
    enrollmentCoordinator: {},
    pairingService: {},
    deviceSessionService: {
      async requireActorDeviceInFamily() {
        throw new Error('not used in this test');
      },
    },
    outboundRelayService: {},
    inboundReconnectService: {},
    statusTracker: {},
    resolveEnvelopeContext: noop,
    deleteNowLedger: {},
    familyAuditService: { record: asyncNoop },
    platformAdminAuthService: {},
    billingCheckoutService: {},
    billingWebhookService: {},
    billingProviderRegistry: {},
    billingRefundOrchestrationService: {},
    billingPaymentRepository: {},
    billingAuditService: {},
    billingFamilyCommercialAuthorityResolver: {},
    commercialNotificationService: {},
    commercialNotificationSupportService: {},
    platformAdminAccountService: {},
    platformAdminEntitlementService: {},
    changeRequestRepository: {},
    entitlementRepository: {},
    priceBookService: {},
    planService: {},
    releaseService: {},
    familyCommercialService: {},
    parentAccountService: service,
    genesisCryptographyAvailable,
    parentPreferenceRepository: undefined,
    safeZoneRepository: {},
    safeZonePolicyAuthorizer: undefined,
    platformAdminComplimentaryGrantService: {},
    complimentaryEntitlementService: undefined,
    freeAccessAccountRepository: {},
    freeAccessAdminService: {},
    platformAdminSettlementService: {},
    removalDecisionAuthority: {},
    protectiveAuthorityResolver: undefined,
  });
}

const VALID_COMPLETION_BODY = {
  challengeId: 'challenge-stub',
  proofSignature: 'proof-signature-stub',
  anchorSignature: 'anchor-signature-stub',
  attestationSignature: 'attestation-signature-stub',
  trustSetEpoch: 1,
  keyEpoch: 1,
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T01:00:00.000Z',
};

// ---------------------------------------------------------------------------
// /genesis/complete -- proof rejection is a 400 about the PROOF
// ---------------------------------------------------------------------------

for (const code of ['INVALID_SIGNATURE', 'NOT_FOUND', 'EXPIRED', 'ALREADY_CONSUMED']) {
  test(`/genesis/complete maps a rejected genesis proof (${code}) to 400 invalid_genesis_proof -- never 401, never 500`, async () => {
    const service = makeStubService({
      completeGenesis: () => {
        throw new GenesisChallengeError(code);
      },
    });
    const app = buildApp({ service });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', headers: AUTHED_HEADERS, payload: VALID_COMPLETION_BODY });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_genesis_proof' });
      assert.equal(service.calls.length, 1);
    } finally {
      await app.close();
    }
  });
}

test('INVARIANT: a genuinely dead session on /genesis/complete is 401 unauthorized -- it is NOT reported as a rejected proof', async () => {
  const service = makeStubService({
    completeGenesis: () => {
      throw new ParentAccountError('UNAUTHORIZED');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', headers: AUTHED_HEADERS, payload: VALID_COMPLETION_BODY });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: 'unauthorized' });
  } finally {
    await app.close();
  }
});

test('INVARIANT: a valid session whose genesis proof is rejected is NEVER answered as a session problem', async () => {
  // The exact production composition: rejecting verifier -> INVALID_SIGNATURE.
  const service = makeStubService({
    completeGenesis: () => {
      throw new GenesisChallengeError('INVALID_SIGNATURE');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', headers: AUTHED_HEADERS, payload: VALID_COMPLETION_BODY });
    assert.notEqual(response.statusCode, 401);
    assert.equal(response.json().error, 'invalid_genesis_proof');
    // The client maps 400 -> GENESIS_REJECTED and 401 -> SESSION_EXPIRED; this
    // is what keeps the parent from being told their session expired.
  } finally {
    await app.close();
  }
});

test('/genesis/complete maps ParentAccountError INVALID_INPUT to 400 invalid_request (not a proof classification)', async () => {
  const service = makeStubService({
    completeGenesis: () => {
      throw new ParentAccountError('INVALID_INPUT');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', headers: AUTHED_HEADERS, payload: VALID_COMPLETION_BODY });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_request' });
  } finally {
    await app.close();
  }
});

test('/genesis/complete rethrows an unexpected infrastructure failure as 500 internal_error with NO leaked message', async () => {
  const service = makeStubService({
    completeGenesis: () => {
      throw new TypeError('connect ECONNREFUSED mysql://internal-host:3306');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', headers: AUTHED_HEADERS, payload: VALID_COMPLETION_BODY });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'internal_error' });
    assert.equal(JSON.stringify(response.body).includes('mysql'), false);
    assert.equal(JSON.stringify(response.body).includes('internal-host'), false);
  } finally {
    await app.close();
  }
});

test('/genesis/complete without a session cookie is answered 401 BEFORE any service call', async () => {
  const service = makeStubService();
  const app = buildApp({ service });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', payload: VALID_COMPLETION_BODY });
    assert.equal(response.statusCode, 401);
    assert.equal(service.calls.length, 0);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// /genesis/challenge -- explicit code-level discrimination
// ---------------------------------------------------------------------------

test('/genesis/challenge maps ParentAccountError UNAUTHORIZED to 401 unauthorized', async () => {
  const service = makeStubService({
    beginGenesisChallenge: () => {
      throw new ParentAccountError('UNAUTHORIZED');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/genesis/challenge',
      headers: AUTHED_HEADERS,
      payload: { publicKey: 'stub-public-key', platform: 'BROWSER' },
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: 'unauthorized' });
  } finally {
    await app.close();
  }
});

test('/genesis/challenge maps ParentAccountError INVALID_INPUT to 400 invalid_request -- not a session problem', async () => {
  const service = makeStubService({
    beginGenesisChallenge: () => {
      throw new ParentAccountError('INVALID_INPUT');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/genesis/challenge',
      headers: AUTHED_HEADERS,
      payload: { publicKey: 'stub-public-key', platform: 'BROWSER' },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_request' });
  } finally {
    await app.close();
  }
});

test('/genesis/challenge maps a genesis-proof public-key failure (INVALID_PUBLIC_KEY) to 400 invalid_request -- a malformed client key is not a 500', async () => {
  // GenesisChallengeService.begin() performs strict P-256 validation and
  // throws GenesisChallengeError('INVALID_PUBLIC_KEY') for a string that is
  // not a valid point. The route pre-check only tests `typeof === 'string'`,
  // so this class reaches the catch for any malformed key.
  const service = makeStubService({
    beginGenesisChallenge: () => {
      throw new GenesisChallengeError('INVALID_PUBLIC_KEY');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/genesis/challenge',
      headers: AUTHED_HEADERS,
      payload: { publicKey: 'not-a-valid-p256-point', platform: 'BROWSER' },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_request' });
  } finally {
    await app.close();
  }
});

test('/genesis/challenge rethrows an unexpected infrastructure failure as 500 internal_error', async () => {
  const service = makeStubService({
    beginGenesisChallenge: () => {
      throw new TypeError('secret internal detail');
    },
  });
  const app = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/genesis/challenge',
      headers: AUTHED_HEADERS,
      payload: { publicKey: 'stub-public-key', platform: 'BROWSER' },
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'internal_error' });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// genesisCryptographyAvailable === false -- fail closed before any ceremony work
// ---------------------------------------------------------------------------

test('flag false: /genesis/challenge answers 503 genesis_unavailable and NEVER calls the service', async () => {
  const service = makeStubService();
  const app = buildApp({ service, genesisCryptographyAvailable: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/genesis/challenge',
      headers: AUTHED_HEADERS,
      payload: { publicKey: 'stub-public-key', platform: 'BROWSER' },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'genesis_unavailable' });
    assert.equal(service.calls.length, 0, 'no challenge may be created when genesis cannot be completed');
  } finally {
    await app.close();
  }
});

test('flag false: /genesis/complete answers 503 genesis_unavailable BEFORE the body is even parsed, and NEVER calls the service', async () => {
  const service = makeStubService();
  const app = buildApp({ service, genesisCryptographyAvailable: false });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', headers: AUTHED_HEADERS, payload: {} });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'genesis_unavailable' });
    assert.equal(service.calls.length, 0, 'no ceremony work may start when genesis cannot be completed');
  } finally {
    await app.close();
  }
});

test('flag false: /genesis/step-up answers 503 genesis_unavailable BEFORE rate limiting and service work', async () => {
  const service = makeStubService();
  const app = buildApp({ service, genesisCryptographyAvailable: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/genesis/step-up',
      headers: AUTHED_HEADERS,
      payload: { email: 'parent@example.test', password: 'a genuinely long password' },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'genesis_unavailable' });
    assert.equal(service.calls.length, 0, 'no step-up code may be requested or burned when genesis cannot be completed');
  } finally {
    await app.close();
  }
});

test('flag false: /genesis/step-up/complete answers 503 genesis_unavailable and NEVER calls the service', async () => {
  const service = makeStubService();
  const app = buildApp({ service, genesisCryptographyAvailable: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/genesis/step-up/complete',
      headers: AUTHED_HEADERS,
      payload: { code: '123456' },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'genesis_unavailable' });
    assert.equal(service.calls.length, 0);
  } finally {
    await app.close();
  }
});

test('flag undefined (composer has not declared the capability): routes proceed normally -- undefined means AVAILABLE', async () => {
  const service = makeStubService({
    completeGenesis: async () => ({ familyId: 'family-stub', deviceId: 'device-stub', keyId: 'key-stub' }),
  });
  const app = buildApp({ service, genesisCryptographyAvailable: undefined });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', headers: AUTHED_HEADERS, payload: VALID_COMPLETION_BODY });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(service.calls.map((c) => c.name), ['completeGenesis']);
  } finally {
    await app.close();
  }
});

test('flag false: a dead session still gets 401 BEFORE the capability check -- session problems are never masked by 503', async () => {
  const service = makeStubService();
  const app = buildApp({ service, genesisCryptographyAvailable: false });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/parent/genesis/complete', payload: VALID_COMPLETION_BODY });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
