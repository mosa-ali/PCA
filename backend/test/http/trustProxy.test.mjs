// PCA-DW-W2-15A -- trustProxy must be a validated CIDR/IP allowlist, never
// a blind `true`, and must fail closed (trust nothing) when unconfigured.
// The integration tests below prove the actual security property: an
// UNTRUSTED peer cannot bypass IP-keyed rate limiting by forging
// X-Forwarded-For, while a genuinely TRUSTED peer's forwarded value IS
// honoured (the legitimate reverse-proxy use case this config exists for).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { InvalidTrustedProxyConfigError, resolveTrustProxyOption } from '../../dist/http/trustProxyConfig.js';

test('resolveTrustProxyOption defaults to false (trust nothing) when unconfigured, in every environment', () => {
  assert.equal(resolveTrustProxyOption({}), false);
  assert.equal(resolveTrustProxyOption({ NODE_ENV: 'production' }), false);
  assert.equal(resolveTrustProxyOption({ NODE_ENV: 'test', PCA_TRUSTED_PROXY_CIDRS: '' }), false);
  assert.equal(resolveTrustProxyOption({ NODE_ENV: 'test', PCA_TRUSTED_PROXY_CIDRS: '   ' }), false);
});

test('resolveTrustProxyOption parses a valid comma-separated IP/CIDR allowlist', () => {
  assert.deepEqual(resolveTrustProxyOption({ PCA_TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 192.168.1.5, ::1' }), ['10.0.0.0/8', '192.168.1.5', '::1']);
});

test('SECURITY: resolveTrustProxyOption FAILS CLOSED (throws) on a malformed entry rather than silently ignoring it', () => {
  assert.throws(() => resolveTrustProxyOption({ PCA_TRUSTED_PROXY_CIDRS: 'not-an-ip' }), InvalidTrustedProxyConfigError);
  assert.throws(() => resolveTrustProxyOption({ PCA_TRUSTED_PROXY_CIDRS: '10.0.0.0/99' }), InvalidTrustedProxyConfigError, 'prefix length out of range for IPv4');
  assert.throws(() => resolveTrustProxyOption({ PCA_TRUSTED_PROXY_CIDRS: '10.0.0.0/abc' }), InvalidTrustedProxyConfigError, 'non-numeric prefix length');
  assert.throws(() => resolveTrustProxyOption({ PCA_TRUSTED_PROXY_CIDRS: '10.0.0.0,,' }), InvalidTrustedProxyConfigError, 'empty entry from a stray comma');
});

test('resolveTrustProxyOption never returns the boolean true', () => {
  const result = resolveTrustProxyOption({ PCA_TRUSTED_PROXY_CIDRS: '10.0.0.0/8' });
  assert.notEqual(result, true);
  assert.ok(Array.isArray(result));
});

function noop() {}
async function asyncNoop() {}

/** Mirrors test/http/buildServerRateLimiting.test.mjs's stub shape -- only /health/db (unauthenticated, IP-rate-limited) is exercised below. */
function buildStubDeps(trustProxy) {
  return {
    trustProxy,
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
    platformAdminEntitlementService: {},
    changeRequestRepository: {},
    entitlementRepository: {},
    priceBookService: {},
    planService: {},
    releaseService: {},
    familyCommercialService: {},
    parentAccountService: {
      async readSession() {
        throw new Error('unauthorized');
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

const UNTRUSTED_PEER = '9.9.9.9';
const RATE_LIMIT_BUDGET = 60;

async function probeDb(app, remoteAddress, forwardedFor) {
  const headers = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {};
  return app.inject({ method: 'GET', url: '/health/db', remoteAddress, headers });
}

test('SECURITY: with trustProxy=false (the default), a spoofed X-Forwarded-For CANNOT bypass IP-keyed rate limiting', async () => {
  const app = buildServer(buildStubDeps(false));
  try {
    // Every request claims a DIFFERENT forwarded IP; if the spoof worked,
    // each would land in its own bucket and none would ever be limited.
    for (let i = 0; i < RATE_LIMIT_BUDGET; i++) {
      const response = await probeDb(app, UNTRUSTED_PEER, `203.0.113.${i % 255}`);
      assert.equal(response.statusCode, 503, `request ${i + 1} should still be within budget`);
    }
    const limited = await probeDb(app, UNTRUSTED_PEER, '203.0.113.250');
    assert.equal(limited.statusCode, 429, 'the real peer address, not the forged header, must be the rate-limit key');
  } finally {
    await app.close();
  }
});

test('SECURITY: an UNTRUSTED peer\'s X-Forwarded-For is ignored even when SOME other CIDR is trusted', async () => {
  const app = buildServer(buildStubDeps(['198.51.100.0/24'])); // trusts a different range, not UNTRUSTED_PEER
  try {
    for (let i = 0; i < RATE_LIMIT_BUDGET; i++) {
      const response = await probeDb(app, UNTRUSTED_PEER, `203.0.113.${i % 255}`);
      assert.equal(response.statusCode, 503, `request ${i + 1} should still be within budget`);
    }
    const limited = await probeDb(app, UNTRUSTED_PEER, '203.0.113.250');
    assert.equal(limited.statusCode, 429, 'a peer outside the trusted allowlist must never have its forwarded header honoured');
  } finally {
    await app.close();
  }
});

test('a TRUSTED peer\'s X-Forwarded-For IS honoured -- the legitimate reverse-proxy topology this config exists for', async () => {
  const app = buildServer(buildStubDeps([`${UNTRUSTED_PEER}/32`]));
  try {
    // Same peer as the "untrusted" tests above, but now explicitly
    // allowlisted -- each distinct forwarded IP must get its own bucket,
    // so none of these should ever be rate limited.
    for (let i = 0; i < RATE_LIMIT_BUDGET + 10; i++) {
      const response = await probeDb(app, UNTRUSTED_PEER, `203.0.113.${i % 255}`);
      assert.equal(response.statusCode, 503, `request ${i + 1} claims a distinct forwarded IP and must not be limited`);
    }
  } finally {
    await app.close();
  }
});
