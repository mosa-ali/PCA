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
//   - main.ts's real production wiring actually injects that safe default
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
// Production wiring stays honest: main.ts really does inject the
// fail-closed default, and buildServer.ts really does thread it through to
// the checkout route. A static source check so a future edit that swaps in
// a permissive/real resolver in main.ts without deliberate review is
// caught here, not discovered live.
// ---------------------------------------------------------------------------

test('PRODUCTION WIRING: main.ts constructs UnavailableFamilyCommercialAuthorityResolver and passes it as billingFamilyCommercialAuthorityResolver', async () => {
  const mainTs = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.match(mainTs, /import\s*\{\s*UnavailableFamilyCommercialAuthorityResolver\s*\}\s*from\s*'\.\/billing\/authority\/FamilyCommercialAuthorityResolver\.js'/);
  assert.match(mainTs, /new UnavailableFamilyCommercialAuthorityResolver\(\)/);
  assert.match(mainTs, /billingFamilyCommercialAuthorityResolver:\s*familyCommercialAuthorityResolver/);
});

test('PRODUCTION WIRING: buildServer.ts threads billingFamilyCommercialAuthorityResolver into registerBillingCheckoutRoutes as familyCommercialAuthorityResolver', async () => {
  const buildServerTs = await readFile(new URL('../../src/http/buildServer.ts', import.meta.url), 'utf8');
  assert.match(buildServerTs, /familyCommercialAuthorityResolver:\s*deps\.billingFamilyCommercialAuthorityResolver/);
});

test('PRODUCTION WIRING: billingCheckoutRoutes.ts awaits resolveOwnerAuthority and fails closed on STALE_OR_REVOKED/INVALID_PROOF exactly like AUTHORITY_UNAVAILABLE', async () => {
  const routesTs = await readFile(new URL('../../src/http/routes/billingCheckoutRoutes.ts', import.meta.url), 'utf8');
  assert.match(routesTs, /await deps\.familyCommercialAuthorityResolver\.resolveOwnerAuthority\(/);
  assert.match(routesTs, /authority\.status === 'AUTHORITY_UNAVAILABLE' \|\| authority\.status === 'STALE_OR_REVOKED' \|\| authority\.status === 'INVALID_PROOF'/);
});
