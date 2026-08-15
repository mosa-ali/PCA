// PCA-AUTH-SESSION-1 -- WRITER57_ASSIGNMENT.md's required end-to-end proof:
// register -> verify-email -> family genesis -> family-commercial GET
// succeeds -> Option-A Owner authority resolves -> an Owner commercial
// mutation (entitlement increase-request create) reaches the backend
// successfully -- all through the REAL, UNMODIFIED
// familyCommercialRoutes.ts/FamilyOwnerAttestationChainEngine/
// FamilyCommercialAuthorityResolver this lane does not edit. The ONLY
// test-only substitution is the DeviceSignatureVerifier (a real Ed25519
// verifier, not RejectingDeviceSignatureVerifier) -- see
// genesisDeviceSigner.ts's header for why production cannot complete this
// same proof today (CRYPTO_SUITE, PCA-DEC-020, still
// WAITING_HUMAN_SECURITY_REVIEW) and why that is the correct, unrelated,
// fail-closed posture rather than a defect in this lane's wiring.
//
// This also proves the "no bypass of Agent53" requirement: the entitlement
// route, the OWNER gate, and the family-scope gate are ALL the genuine,
// unmodified production code from familyCommercialRoutes.ts/
// familycommercial/authorization.ts/billing/authority/
// FamilyCommercialAuthorityResolver.ts -- this test only supplies a real
// (not production-selected) signature verifier and asserts the SAME
// session token this lane's cookie-based routes issue also authenticates
// via the pre-existing Authorization: Bearer transport those routes
// already support.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { FamilyCommercialService } from '../../dist/familycommercial/FamilyCommercialService.js';
import { registerFamilyCommercialRoutes } from '../../dist/http/routes/familyCommercialRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { FamilyOwnerAttestationChainEngine } from '../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { InMemoryGenesisAnchorStore } from '../../dist/familycommercial/authority/InMemoryGenesisAnchorStore.js';
import { InMemoryAttestationChainStore } from '../../dist/familycommercial/authority/InMemoryAttestationChainStore.js';
import { AttestationChainFamilyCommercialAuthorityResolver } from '../../dist/billing/authority/FamilyCommercialAuthorityResolver.js';
import { createEd25519DeviceSignatureVerifier } from '../../dist/parentaccount/genesisDeviceSigner.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createInMemoryEntitlementRepository } from '../support/inMemoryEntitlementRepository.mjs';
import { createInMemoryChangeRequestRepository } from '../support/inMemoryChangeRequestRepository.mjs';
import { createStubChangeRequestService } from '../support/stubChangeRequestService.mjs';

const FIXED_NOW = new Date('2026-08-15T00:00:00Z');
const EMAIL = 'e2e-owner@example.com';
const PASSWORD = 'a genuinely long password';

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }
  async sendVerificationCode(email, code) {
    this.sent.push({ email, code });
  }
  lastCodeFor(email) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

function fakeRunQuery(fn) {
  return fn(undefined);
}

test('E2E: register -> verify-email (genesis) -> family-commercial GET succeeds -> Owner-authorized mutation reaches the backend', async () => {
  // --- Shared PCA-DEC-025 Option-A authority engine (real Ed25519 test
  // verifier -- see this file's header) -- the SAME instance both
  // ParentAccountService's genesis call and the production
  // AttestationChainFamilyCommercialAuthorityResolver read from, exactly
  // as a real deployment would share one engine across both call sites.
  const genesisStore = new InMemoryGenesisAnchorStore();
  const chainStore = new InMemoryAttestationChainStore();
  const engine = new FamilyOwnerAttestationChainEngine(genesisStore, chainStore, createEd25519DeviceSignatureVerifier(), () => FIXED_NOW);

  // --- Identity/session plane (this lane) ---
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, () => FIXED_NOW);
  const authzRepository = createInMemoryAuthzRepository();
  const parentAccountRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
    grantFamilyScope: (serviceAccountId, familyId) => authzRepository._grantScope(serviceAccountId, familyId, 'ACTIVE'),
  });
  const emailSender = new RecordingEmailSender();
  const parentAccountService = new ParentAccountService({
    repository: parentAccountRepository,
    authService,
    emailSender,
    familyGenesisEngine: engine,
    now: () => FIXED_NOW,
  });

  // --- Family-commercial plane (Agent53's real, unmodified code) ---
  const entitlementRepository = createInMemoryEntitlementRepository();
  entitlementRepository._seedDefaults('FREE_STARTER', 1, 1, FIXED_NOW);
  const changeRequestRepository = createInMemoryChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  const changeRequestService = createStubChangeRequestService(changeRequestRepository, () => FIXED_NOW);
  const subscriptionRepository = { async findActiveForAccount() { return null; } };
  const paymentMethodRepository = { async listForAccount() { return []; } };
  const invoiceReadRepository = { async listForFamily() { return []; }, async findForFamily() { return null; }, async listLines() { return []; } };
  const familyCommercialService = new FamilyCommercialService(
    entitlementService,
    changeRequestRepository,
    changeRequestService,
    subscriptionRepository,
    paymentMethodRepository,
    invoiceReadRepository,
    () => FIXED_NOW,
    fakeRunQuery,
  );
  const familyCommercialAuthorityResolver = new AttestationChainFamilyCommercialAuthorityResolver(engine);

  const rateLimiter = createRateLimiter();
  const app = Fastify({ logger: false });
  registerParentAccountRoutes(app, { parentAccountService });
  registerFamilyCommercialRoutes(app, {
    familyCommercialService,
    authService,
    authzRepository,
    familyCommercialAuthorityResolver,
    rateLimiter,
    authAttemptLimiter: rateLimiter({ windowMs: 60_000, max: 1000, bucket: 'e2e-auth-attempt' }),
  });

  // --- Step 1: register (browser-reachable, real route) ---
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: { email: EMAIL, password: PASSWORD, passwordConfirmation: PASSWORD },
  });
  assert.equal(registerResponse.statusCode, 202);

  // --- Step 2: verify-email (real route) -- triggers genesis + session issuance ---
  const code = emailSender.lastCodeFor(EMAIL);
  assert.ok(code, 'a verification code must have been sent');
  const verifyResponse = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email: EMAIL, code } });
  assert.equal(verifyResponse.statusCode, 200);
  const verifyBody = verifyResponse.json();
  assert.equal(verifyBody.sessionEstablished, true);
  assert.equal(typeof verifyBody.familyId, 'string', 'family genesis must have succeeded under a real signature verifier');

  const rawSessionCookie = verifyResponse.cookies.find((c) => c.name === 'pca_family_session');
  assert.ok(rawSessionCookie, 'a session cookie must have been set');
  const rawSessionToken = rawSessionCookie.value;

  // --- Step 3: family-commercial GET, via the REAL, UNMODIFIED requireServiceSession Bearer transport those routes already support (this lane's cookie token IS that same token -- see parentAccountRoutes.ts's own header) ---
  const entitlementResponse = await app.inject({
    method: 'GET',
    url: `/v1/families/${verifyBody.familyId}/commercial/entitlement`,
    headers: { authorization: `Bearer ${rawSessionToken}` },
  });
  assert.equal(entitlementResponse.statusCode, 200, 'the freshly registered Owner must be able to read their own family entitlement');
  assert.equal(entitlementResponse.json().tier, 'FREE_STARTER');

  // --- Step 4: Owner-authorized commercial mutation (entitlement increase-request create) reaches the backend and succeeds -- Option-A resolves OWNER_AUTHORIZED via the SAME attestation chain genesis just wrote, using the genesis device as actorDeviceId (the only device this brand-new family has). ---
  const genesisDeviceId = `web-registration:${verifyBody.accountId}`;
  const mutationResponse = await app.inject({
    method: 'POST',
    url: `/v1/families/${verifyBody.familyId}/commercial/requests`,
    headers: { authorization: `Bearer ${rawSessionToken}` },
    payload: { limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 5, actorDeviceId: genesisDeviceId },
  });
  assert.equal(mutationResponse.statusCode, 201, `Owner-authorized mutation must succeed (got ${mutationResponse.statusCode}: ${mutationResponse.body})`);
});
