import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { clientAddressKey } from '../../dist/http/clientAddress.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';

// S8 follow-up (2026-09-24): per-IP rate limits must key on the RESOLVED
// client address with a forwarded ":port" stripped, while every spoofing
// boundary stays in @fastify/proxy-addr under the CIDR allowlist.
//
// Production symptom this pins: App Service appends
// `X-Forwarded-For: <client-ip>:<port>` (the client's ephemeral source
// port), so the pre-fix key was a DIFFERENT `ip:port` string per request
// and per-IP budgets never accumulated (observed live: 42 + 35 requests
// from two independent client networks, zero per-IP 429s, while the
// per-email budget tripped exactly at its cap). These tests exercise the
// REAL buildServer() composition with the production trust ranges.

const PRODUCTION_TRUST_RANGES = ['169.254.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
const ACTIVATION_ROUTE = '/platform-admin/activation/start';
const LOGIN_ROUTE = '/api/parent/login';

function noop() {}
async function asyncNoop() {}

/** Same stub-deps pattern as buildServerRateLimiting.test.mjs; only the fields these routes reach are meaningfully implemented (bogus tokens/credentials are rejected before any dependency is called). */
function buildStubDeps() {
  return {
    authService: { requireServiceSession: asyncNoop },
    authzService: {},
    authzRepository: {},
    invitationService: {},
    enrollmentCoordinator: {},
    pairingService: {},
    deviceSessionService: {
      async requireActorDeviceInFamily() {
        throw new RuntimeSyncAuthError('UNAUTHORIZED');
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
    platformAdminActivationService: {},
    platformAdminEntitlementService: {},
    changeRequestRepository: {},
    entitlementRepository: {},
    priceBookService: {},
    planService: {},
    releaseService: {},
    familyCommercialService: {},
    // The login route's rate limiter is consumed BEFORE this service is
    // called; within budget the route answers 200 (step-up required).
    parentAccountService: {
      async readSession() {
        throw new Error('unauthorized');
      },
      async login() {
        return { status: 'STEP_UP_REQUIRED' };
      },
    },
    parentPreferenceRepository: undefined,
    safeZoneRepository: {},
    safeZonePolicyAuthorizer: {},
    platformAdminComplimentaryGrantService: {},
    complimentaryEntitlementService: undefined,
    freeAccessAccountRepository: {},
    freeAccessAdminService: {},
    platformAdminSettlementService: {},
    removalDecisionAuthority: {
      async listRequests() {
        return [];
      },
    },
    protectiveAuthorityResolver: undefined,
    familyMemberInvitationService: {},
    familyAuditEventLedger: {},
    protectionAlertLedger: {},
    dashboardAggregatorService: {},
  };
}

function makeApp(trustProxy) {
  return buildServer({ ...buildStubDeps(), trustProxy });
}

async function activationHit(app, remoteAddress, headers) {
  return app.inject({ method: 'POST', url: ACTIVATION_ROUTE, remoteAddress, headers, payload: { token: 'x' } });
}

test('T1: forwarded IPv4:port with rotating ports from a trusted peer accumulates and trips the per-IP budget', async () => {
  const app = makeApp(PRODUCTION_TRUST_RANGES);
  try {
    for (let i = 1; i <= 10; i++) {
      const within = await activationHit(app, '10.0.0.5', { 'x-forwarded-for': `203.0.113.9:${51000 + i}` });
      assert.equal(within.statusCode, 401, `request ${i} should be within budget (got ${within.statusCode})`);
    }
    const eleventh = await activationHit(app, '10.0.0.5', { 'x-forwarded-for': '203.0.113.9:51011' });
    assert.equal(eleventh.statusCode, 429);
    assert.deepEqual(eleventh.json(), { error: 'rate_limited' });

    // A DIFFERENT client behind the same trusted peer is a DIFFERENT
    // budget -- proving the key is the resolved client address, not the
    // proxy peer (and, with trustProxy disabled, this leg is what fails).
    const otherClient = await activationHit(app, '10.0.0.5', { 'x-forwarded-for': '203.0.113.10:52000' });
    assert.equal(otherClient.statusCode, 401, `a different client must have its own budget (got ${otherClient.statusCode})`);
  } finally {
    await app.close();
  }
});

test('T1b: forwarded IPv4:port with rotating ports accumulates and trips the parent login per-IP budget (max 30)', async () => {
  const app = makeApp(PRODUCTION_TRUST_RANGES);
  try {
    for (let i = 1; i <= 30; i++) {
      const within = await app.inject({
        method: 'POST',
        url: LOGIN_ROUTE,
        remoteAddress: '10.0.0.5',
        headers: { 'x-forwarded-for': `203.0.113.20:${53000 + i}` },
        payload: { email: `rl-s8-${i}@example.invalid`, password: 'x' },
      });
      assert.notEqual(within.statusCode, 429, `request ${i} should be within budget (got ${within.statusCode})`);
    }
    const thirtyFirst = await app.inject({
      method: 'POST',
      url: LOGIN_ROUTE,
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '203.0.113.20:53031' },
      payload: { email: 'rl-s8-31@example.invalid', password: 'x' },
    });
    assert.equal(thirtyFirst.statusCode, 429);
  } finally {
    await app.close();
  }
});

test('T2: forwarded [IPv6]:port with rotating ports accumulates and trips the budget', async () => {
  const app = makeApp(PRODUCTION_TRUST_RANGES);
  try {
    for (let i = 1; i <= 10; i++) {
      const within = await activationHit(app, '10.0.0.5', { 'x-forwarded-for': `[2001:db8::9]:${51000 + i}` });
      assert.equal(within.statusCode, 401, `request ${i} should be within budget (got ${within.statusCode})`);
    }
    const eleventh = await activationHit(app, '10.0.0.5', { 'x-forwarded-for': '[2001:db8::9]:51011' });
    assert.equal(eleventh.statusCode, 429);
  } finally {
    await app.close();
  }
});

test('T3 spoof negative control A: a forged X-Forwarded-For from an untrusted socket peer never becomes the identity', async () => {
  const app = makeApp(PRODUCTION_TRUST_RANGES);
  try {
    for (let i = 1; i <= 10; i++) {
      const within = await activationHit(app, '198.51.100.20', { 'x-forwarded-for': `203.0.113.9:${51000 + i}` });
      assert.notEqual(within.statusCode, 429, `request ${i} should be within budget (got ${within.statusCode})`);
    }
    const eleventh = await activationHit(app, '198.51.100.20', { 'x-forwarded-for': '203.0.113.9:51011' });
    assert.equal(eleventh.statusCode, 429, 'the budget must be the socket peer, never the forged header');

    const otherPeer = await activationHit(app, '198.51.100.21', { 'x-forwarded-for': '203.0.113.9:51011' });
    assert.equal(otherPeer.statusCode, 401, 'the same forged value from a different peer must be a fresh budget');

    const samePeerNewClaim = await activationHit(app, '198.51.100.20', { 'x-forwarded-for': '203.0.113.250:9' });
    assert.equal(samePeerNewClaim.statusCode, 429, 'a different forged value from the same peer must stay on the peer budget');
  } finally {
    await app.close();
  }
});

test('T4 spoof negative control B: an attacker-prepended entry cannot displace the platform-appended real client (last-untrusted-hop rule untouched)', async () => {
  const app = makeApp(PRODUCTION_TRUST_RANGES);
  try {
    for (let i = 1; i <= 10; i++) {
      const within = await activationHit(app, '10.0.0.5', { 'x-forwarded-for': `1.1.1.${i}:1, 203.0.113.9:${51000 + i}` });
      assert.notEqual(within.statusCode, 429, `request ${i} should be within budget (got ${within.statusCode})`);
    }
    // Rotating the forged first entry must not fork the budget: the
    // identity remains the last untrusted hop, 203.0.113.9.
    const eleventh = await activationHit(app, '10.0.0.5', { 'x-forwarded-for': '1.1.1.99:1, 203.0.113.9:51011' });
    assert.equal(eleventh.statusCode, 429);
    assert.deepEqual(eleventh.json(), { error: 'rate_limited' });
  } finally {
    await app.close();
  }
});

test('T5: no X-Forwarded-For -> the raw peer address remains the key (unchanged behaviour)', async () => {
  const app = makeApp(PRODUCTION_TRUST_RANGES);
  try {
    for (let i = 1; i <= 10; i++) {
      const within = await activationHit(app, '10.0.0.5', undefined);
      assert.notEqual(within.statusCode, 429, `request ${i} should be within budget (got ${within.statusCode})`);
    }
    const eleventh = await activationHit(app, '10.0.0.5', undefined);
    assert.equal(eleventh.statusCode, 429);
  } finally {
    await app.close();
  }
});

test('T6: clientAddressKey strips ONLY the two forwarded shapes', () => {
  assert.equal(clientAddressKey({ ip: '203.0.113.9:51001' }), '203.0.113.9');
  assert.equal(clientAddressKey({ ip: '[2001:db8::9]:51001' }), '2001:db8::9');
  assert.equal(clientAddressKey({ ip: '2001:db8::9' }), '2001:db8::9');
  assert.equal(clientAddressKey({ ip: '203.0.113.9' }), '203.0.113.9');
  assert.equal(clientAddressKey({ ip: 'not-an-ip:12' }), 'not-an-ip:12');
  assert.equal(clientAddressKey({ ip: '203.0.113.9:99999' }), '203.0.113.9:99999');
  assert.equal(clientAddressKey({ ip: '999.999.999.999:80' }), '999.999.999.999:80');
});
