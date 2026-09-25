// PCA-BILL-2A-R1 correction, FIX 4: family owner authority. Proves, at the
// resolver level (the same fixture-building pattern
// test/familyrbac/TrustSetRoleResolver.test.mjs already established for
// TrustSetRoleResolver itself), that:
//   - Family Owner checkout-authority resolves OWNER_AUTHORIZED
//   - Administrator/Viewer resolve ROLE_DENIED (never silently ALLOW)
//   - no trust set / wrong family / device not in trust set / device not
//     ACTIVE all resolve AUTHORITY_UNAVAILABLE (never silently DENIED,
//     and never silently ALLOWED)
//   - the safe production default (UnavailableFamilyCommercialAuthorityResolver)
//     always returns AUTHORITY_UNAVAILABLE, unconditionally
//   - main.ts's production wiring (PCA-DEC-030) composes the ADMINISTRATOR +
//     fresh-TOTP ParentCommercialStepUpAuthority instead of any resolver
//     (a static source-level check that keeps this fail-closed posture
//     honest against a future silent regression -- mirrors this
//     codebase's other schema-privacy/source-shape static assertions).
//
// PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025/Option A): resolveOwnerAuthority is now
// async (see FamilyCommercialAuthorityResolver.ts's header) -- every call
// below is awaited accordingly. The dedicated
// AttestationChainFamilyCommercialAuthorityResolver / genesis-anchored
// chain test matrix lives in
// test/familycommercial/authority/FamilyOwnerAttestationChainEngine.test.mjs,
// not here -- this file stays scoped to the resolver adapters themselves.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import {
  UnavailableFamilyCommercialAuthorityResolver,
  TrustSetFamilyCommercialAuthorityResolver,
} from '../../dist/billing/authority/FamilyCommercialAuthorityResolver.js';

function epoch(overrides = {}) {
  return {
    familyId: 'fam-1',
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-admin', role: 'ADMINISTRATOR', dskKeyId: 'k3', dskPublicKey: 'pk3', dekKeyId: 'k4', dekPublicKey: 'pk4', status: 'ACTIVE' },
      { deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'ACTIVE' },
      { deviceId: 'dev-revoked-owner', role: 'OWNER', dskKeyId: 'k7', dskPublicKey: 'pk7', dekKeyId: 'k8', dekPublicKey: 'pk8', status: 'REVOKED' },
    ],
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    supersedesEpoch: null,
    signature: 'sig',
    ...overrides,
  };
}

function buildResolver(epochOrNull) {
  const store = new InMemoryFamilyTrustSetStore();
  if (epochOrNull) store.setCurrentEpoch(epochOrNull);
  return new TrustSetFamilyCommercialAuthorityResolver(new FamilyTrustSetRoleResolver(store));
}

// ---------------------------------------------------------------------------
// UnavailableFamilyCommercialAuthorityResolver -- the production default
// ---------------------------------------------------------------------------

test('UnavailableFamilyCommercialAuthorityResolver always returns AUTHORITY_UNAVAILABLE, never a permissive default, regardless of input', async () => {
  const resolver = new UnavailableFamilyCommercialAuthorityResolver();
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-1', 'dev-owner'), { status: 'AUTHORITY_UNAVAILABLE' });
  assert.deepEqual(await resolver.resolveOwnerAuthority('any-family', 'any-device'), { status: 'AUTHORITY_UNAVAILABLE' });
  assert.deepEqual(await resolver.resolveOwnerAuthority('', ''), { status: 'AUTHORITY_UNAVAILABLE' });
});

// ---------------------------------------------------------------------------
// TrustSetFamilyCommercialAuthorityResolver -- tests-only real implementation
// ---------------------------------------------------------------------------

test('Family Owner checkout: OWNER_AUTHORIZED', async () => {
  const resolver = buildResolver(epoch());
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-1', 'dev-owner'), { status: 'OWNER_AUTHORIZED' });
});

test('Administrator checkout: ROLE_DENIED (never ALLOW)', async () => {
  const resolver = buildResolver(epoch());
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-1', 'dev-admin'), { status: 'ROLE_DENIED' });
});

test('Viewer checkout: ROLE_DENIED (never ALLOW)', async () => {
  const resolver = buildResolver(epoch());
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-1', 'dev-viewer'), { status: 'ROLE_DENIED' });
});

test('wrong family: AUTHORITY_UNAVAILABLE, never silently DENIED or ALLOWED (FAMILY_MISMATCH is a resolution failure, not a role determination)', async () => {
  const resolver = buildResolver(epoch({ familyId: 'fam-1' }));
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-OTHER', 'dev-owner'), { status: 'AUTHORITY_UNAVAILABLE' });
});

test('no trust set at all: AUTHORITY_UNAVAILABLE', async () => {
  const resolver = buildResolver(null);
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-1', 'dev-owner'), { status: 'AUTHORITY_UNAVAILABLE' });
});

test('device not in trust set: AUTHORITY_UNAVAILABLE (never ROLE_DENIED -- a resolution failure, not a determined-and-wrong role)', async () => {
  const resolver = buildResolver(epoch());
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-1', 'dev-unknown'), { status: 'AUTHORITY_UNAVAILABLE' });
});

test('device present but REVOKED (not ACTIVE), even claiming OWNER: AUTHORITY_UNAVAILABLE, never OWNER_AUTHORIZED', async () => {
  const resolver = buildResolver(epoch());
  assert.deepEqual(await resolver.resolveOwnerAuthority('fam-1', 'dev-revoked-owner'), { status: 'AUTHORITY_UNAVAILABLE' });
});

// ---------------------------------------------------------------------------
// Production wiring stays honest (PCA-DEC-030). The resolver adapters above
// remain as library code, but production no longer gates checkout on a
// device-signature owner attestation: main.ts composes
// COMMERCIAL_OWNER_AUTHORITY = FAMILY ADMINISTRATOR + FRESH TOTP STEP-UP
// (ParentCommercialStepUpAuthority) and buildServer.ts threads that ONE
// instance into the checkout route. A static source check so a future edit
// that silently swaps in a permissive/other gate is caught here, not live.
// ---------------------------------------------------------------------------

test('PRODUCTION WIRING: main.ts constructs ParentCommercialStepUpAuthority over the real account/membership/MFA stores and passes it as commercialOwnerAuthority -- the attestation-chain resolver is no longer composed', async () => {
  const mainTs = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.match(mainTs, /import\s*\{\s*ParentCommercialStepUpAuthority\s*\}\s*from\s*'\.\/parentaccount\/mfa\/ParentCommercialStepUpAuthority\.js'/);
  assert.match(
    mainTs,
    /const commercialOwnerAuthority = new ParentCommercialStepUpAuthority\(\{\s*accounts:\s*parentAccountRepository,\s*memberships:\s*familyMembershipRepository,\s*mfa:\s*parentMfaService,\s*\}\)/,
  );
  assert.match(mainTs, /^\s*commercialOwnerAuthority,\s*$/m, 'the same instance is handed to buildServer');
  assert.doesNotMatch(mainTs, /new AttestationChainFamilyCommercialAuthorityResolver\(/);
  assert.doesNotMatch(mainTs, /billingFamilyCommercialAuthorityResolver/);
  assert.doesNotMatch(mainTs, /UnavailableFamilyCommercialAuthorityResolver|TrustSetFamilyCommercialAuthorityResolver/, 'no resolver adapter may be silently re-wired as the checkout gate');
});

test('PRODUCTION WIRING: buildServer.ts threads commercialOwnerAuthority into registerBillingCheckoutRoutes and registerFamilyCommercialRoutes -- no device-attestation resolver dependency remains', async () => {
  const buildServerTs = await readFile(new URL('../../src/http/buildServer.ts', import.meta.url), 'utf8');
  assert.match(buildServerTs, /registerBillingCheckoutRoutes\(app, \{[^}]*commercialOwnerAuthority:\s*deps\.commercialOwnerAuthority,[^}]*\}\)/s);
  assert.match(buildServerTs, /registerFamilyCommercialRoutes\(app, \{[^}]*commercialOwnerAuthority:\s*deps\.commercialOwnerAuthority,[^}]*\}\)/s);
  assert.match(buildServerTs, /commercialOwnerAuthority:\s*Pick<ParentCommercialStepUpAuthority, 'authorize'>;/, 'a required (non-optional) dependency');
  assert.doesNotMatch(buildServerTs, /billingFamilyCommercialAuthorityResolver|familyCommercialAuthorityResolver|familyAuthorityRequestChallengeService|authorityDeviceDirectory|genesisCryptographyAvailable/);
});

test('PRODUCTION WIRING: billingCheckoutRoutes.ts authorizes BILLING_CHECKOUT_CREATE with the body stepUpToken BEFORE checkout, and denies both ROLE_DENIED and STEP_UP_REQUIRED with 403', async () => {
  const routesTs = await readFile(new URL('../../src/http/routes/billingCheckoutRoutes.ts', import.meta.url), 'utf8');
  assert.match(routesTs, /await deps\.commercialOwnerAuthority\.authorize\(request\.accountId as string, familyId, 'BILLING_CHECKOUT_CREATE', stepUpToken\)/);
  assert.match(routesTs, /authority === 'ROLE_DENIED'\) \{[^}]*reply\.code\(403\)\.send\(\{ error: 'forbidden' \}\)/s);
  assert.match(routesTs, /authority === 'STEP_UP_REQUIRED'\) \{[^}]*reply\.code\(403\)\.send\(\{ error: 'forbidden', code: 'STEP_UP_REQUIRED' \}\)/s);
  const gateIndex = routesTs.indexOf('commercialOwnerAuthority.authorize(');
  const checkoutIndex = routesTs.indexOf('checkoutService.createCheckoutSession(');
  assert.ok(gateIndex > 0 && checkoutIndex > gateIndex, 'the owner gate runs before any checkout orchestration');
  assert.doesNotMatch(routesTs, /resolveOwnerAuthority|actorDeviceId|authorityProof/);
});
