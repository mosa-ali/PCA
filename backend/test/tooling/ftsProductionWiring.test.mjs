// WAVE 5B — FTS production-wiring ATOMIC-SET guard.
//
// The approved Wave-4 sequence (Wave 5B) activated the store-backed
// trust-set ROLE RESOLVER in production composition (main.ts) while the
// cryptographic ACCEPTANCE writer stays UNWIRED and the envelope-context
// epoch floors stay REJECTING (unattainable). Those three facts are one
// atomic set: a resolution swap is safe ONLY while no accepted epoch can
// ever be created and no non-rejecting envelope floor/verifier exists, so
// the resolver can only ever answer NO_TRUST_SET. If a future wave wires
// ingestion -- the acceptance service into any production path, a
// non-rejecting envelope verifier, or attainable envelope floors --
// WITHOUT replacing the whole set together, this gate fails loudly instead
// of letting production drift into a partially-wired authority state.
//
// WAVE 6B amendment: the set above stays in force, and a SECOND activation
// lane is added to the composition -- the first-device trust-root bootstrap
// ceremony (owner rulings D4/F4). That lane may exist in production ONLY
// terminated by the fail-closed attestation boundary: main.ts constructs
// FailClosedAttestationVerifier (which can never answer VERIFIED), so no
// submission -- valid or not -- can ever reach the ceremony's
// single-transaction commit. The acceptance writer keeps its Wave-5B pin,
// the bootstrap lane gains positive construction pins, and permissive
// attestation verifier tokens are banned everywhere.
//
// This file intentionally checks SOURCE TEXT (like
// productionInMemoryStores.test.mjs / productionPathCertification.test.mjs
// already do for their own composition invariants) and includes a GATE
// SELF-TEST proving the checks can actually fail (the permanent principle:
// a gate must be demonstrably able to fail).
//
// WAVE 6C amendment: the temporary 6B fail-closed pin is replaced by the
// REAL platform attestation router (createPlatformAttestationVerifier),
// which is itself fail-closed by construction: with absent/empty/malformed
// pinned-root configuration the Android lane answers UNAVAILABLE and never
// VERIFIED, and iOS stays unimplemented. main.ts must construct the router
// (never a bare fail-closed class, never a permissive double), pinned roots
// may never appear as PEM literals in src (configuration only), and the
// permissive-verifier token bans are extended with test/mock/fake/bypass
// names so no such construction can ever enter production composition.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));

function read(relativePath) {
  return readFileSync(path.join(backendRoot, relativePath), 'utf8');
}

function listSourceFiles(dir) {
  return readdirSync(path.join(backendRoot, dir), { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'))
    .map((entry) => `${dir}/${entry}`.replace(/\\/g, '/'));
}

/**
 * Pure checker: returns the list of violations for a given main.ts text and
 * a map of source-file-path -> text for the rest of backend/src.
 */
export function findFtsWiringViolations(mainText, sourceFiles) {
  const violations = [];

  // 1. The store-backed resolver is the ONE production resolver, wired with
  //    the durable accepted-epoch store; the Unavailable construction must
  //    be gone from production composition.
  if (!mainText.includes('new StoreBackedTrustSetRoleResolver({ epochStore: trustSetEpochStore })')) {
    violations.push('main.ts must construct the store-backed trust-set role resolver over the shared trustSetEpochStore');
  }
  if (mainText.includes('new UnavailableTrustSetRoleResolver(')) {
    violations.push('main.ts must not still construct the Unavailable trust-set role resolver');
  }

  // 2. The envelope-context floor/verifier set stays rejecting.
  for (const needle of [
    'rejectingResolveEnvelopeContext',
    'RejectingEnvelopeSignatureVerifier',
    'RejectingDeviceSignatureVerifier',
  ]) {
    if (!mainText.includes(needle)) {
      violations.push(`main.ts must keep the rejecting composition member: ${needle}`);
    }
  }

  // 2b. The production root itself must never construct the acceptance
  //     service/verifier or call the append writers: activation requires the
  //     owner-authorized coordinate set swap, not a drive-by wiring.
  for (const needle of [
    'new TrustSetEpochAcceptanceService(',
    '.appendAcceptedEpoch(',
    'appendAcceptedEpochOnConnection',
    'appendGenesisEpochOnConnection',
    'P256TrustSetSignatureVerifier',
    'decodeCanonicalTrustSetEpoch',
  ]) {
    if (mainText.includes(needle)) {
      violations.push(`main.ts must not reference ${needle} (the acceptance writer/verifier stay unwired)`);
    }
  }

  // 2c. Wave 6B/6C: the first-device trust-root bootstrap lane must be
  //     wired in exactly its real-but-fail-closed shape -- the service over
  //     the MySQL store over the SHARED epoch store, terminated by the
  //     platform attestation router constructed from explicit environment
  //     configuration. Removing any pin silently disarms the boundary.
  for (const pin of [
    'new FirstDeviceBootstrapService({',
    'store: new MySqlFirstDeviceBootstrapStore({ epochStore: trustSetEpochStore }),',
    'attestationVerifier: platformAttestationVerifier,',
    'createPlatformAttestationVerifier(process.env)',
    'firstDeviceBootstrapService,',
  ]) {
    if (!mainText.includes(pin)) {
      violations.push(`main.ts must keep the fail-closed bootstrap wiring pin: ${pin}`);
    }
  }
  if (mainText.includes('new FailClosedAttestationVerifier(')) {
    violations.push(
      'main.ts must construct the platform attestation router via createPlatformAttestationVerifier, not a bare fail-closed class directly',
    );
  }

  // 2d. No permissive attestation verifier may exist anywhere in src: the
  //     ceremony lane is admissible in production only behind the real
  //     platform verifier (ruling 11 + Wave 6C), so a stub/bypass verifier
  //     construction is a violation on sight. Test doubles live in test/
  //     fixtures and never in src. PEM certificate literals are likewise
  //     banned from src: pinned roots arrive ONLY via explicit runtime
  //     configuration, never as compiled-in trust material.
  for (const [file, text] of Object.entries({ 'src/main.ts': mainText, ...sourceFiles })) {
    for (const token of [
      'StubAttestationVerifier',
      'PermissiveAttestationVerifier',
      'AcceptAllAttestationVerifier',
      'AlwaysVerifiedAttestationVerifier',
      'TestAttestationVerifier',
      'MockAttestationVerifier',
      'FakeAttestationVerifier',
      'BypassAttestationVerifier',
      'DebugAttestationVerifier',
    ]) {
      if (text.includes(token)) {
        violations.push(`${file} must not contain the permissive attestation verifier token ${token}`);
      }
    }
    if (/-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=]{40,}/.test(text)) {
      violations.push(`${file} must not embed PEM certificate material (pinned roots arrive only via explicit configuration)`);
    }
    // Stage-B hardening (Agent-3 MINOR-4): the escaped-newline and
    // concatenated spellings are the SAME compiled-in trust material as the
    // multi-line literal. A bare marker stays allowed OUTSIDE main.ts
    // (src/db/pool.ts documents the marker in a comment); main.ts never
    // gets to mention it at all.
    if (/-----BEGIN CERTIFICATE-----\\n[A-Za-z0-9+/=]{40,}/.test(text)) {
      violations.push(`${file} must not embed PEM certificate material via escaped newlines`);
    }
    if (file === 'src/main.ts' && text.includes('-----BEGIN CERTIFICATE-----')) {
      violations.push('src/main.ts must not mention the PEM certificate marker at all (pinned roots arrive only via explicit runtime configuration)');
    }
  }

  // 3. The acceptance writer/verifier/decoder stay out of production paths:
  //    never in http routes, and (outside the familytrustset module itself)
  //    referenced by main.ts's resolver swap only as allowed below.
  for (const [file, text] of Object.entries(sourceFiles)) {
    const normalized = file.replace(/\\/g, '/');
    const inFamilytrustsetModule = normalized.startsWith('src/familytrustset/');
    const isMain = normalized === 'src/main.ts';

    if (normalized.startsWith('src/http/')) {
      // Wave 6B: routes may now legitimately import from the familytrustset
      // module (the first-device ceremony routes), so the blunt module-name
      // needle is gone -- but no route may ever reference the acceptance
      // writer/verifier/decoder, the epoch store class, or the resolver.
      for (const needle of [
        'TrustSetEpochStore',
        'StoreBackedTrustSetRoleResolver',
        'appendAcceptedEpoch',
        'appendAcceptedEpochOnConnection',
        'appendGenesisEpochOnConnection',
        'TrustSetEpochAcceptance',
        'P256TrustSetSignatureVerifier',
        'decodeCanonicalTrustSetEpoch',
      ]) {
        if (text.includes(needle)) {
          violations.push(`${file} must not reference ${needle} (no route activation of the acceptance path)`);
        }
      }
    }

    if (!inFamilytrustsetModule && !isMain) {
      for (const needle of [
        'TrustSetEpochAcceptance',
        'appendAcceptedEpoch',
        'appendAcceptedEpochOnConnection',
        'appendGenesisEpochOnConnection',
        'P256TrustSetSignatureVerifier',
        'decodeCanonicalTrustSetEpoch',
        'StoreBackedTrustSetRoleResolver',
      ]) {
        if (text.includes(needle)) {
          violations.push(`${file} must not reference ${needle} outside the familytrustset module and main.ts's resolver swap`);
        }
      }
    }
  }

  return violations;
}

test('GATE SELF-TEST: the checker detects a partially-wired composition and accepts the frozen one', () => {
  const goodMain = [
    'const trustSetEpochStore = new MySqlTrustSetEpochStore();',
    'const trustSetRoleResolver = new StoreBackedTrustSetRoleResolver({ epochStore: trustSetEpochStore });',
    'const platformAttestationVerifier = createPlatformAttestationVerifier(process.env);',
    'const firstDeviceBootstrapService = new FirstDeviceBootstrapService({',
    '  store: new MySqlFirstDeviceBootstrapStore({ epochStore: trustSetEpochStore }),',
    '  attestationVerifier: platformAttestationVerifier,',
    '});',
    'firstDeviceBootstrapService,',
    'resolveEnvelopeContext: rejectingResolveEnvelopeContext,',
    'RejectingEnvelopeSignatureVerifier',
    'RejectingDeviceSignatureVerifier',
  ].join('\n');
  assert.deepEqual(findFtsWiringViolations(goodMain, {}), []);

  // Each mutation of the frozen set must be reported.
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('new StoreBackedTrustSetRoleResolver({ epochStore: trustSetEpochStore })', 'new UnavailableTrustSetRoleResolver()'), {}),
    [],
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('rejectingResolveEnvelopeContext', 'realResolveEnvelopeContext'), {}),
    [],
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('attestationVerifier: platformAttestationVerifier,', 'attestationVerifier: stubVerifier,'), {}),
    [],
    'unpinning the platform attestation router at the service construction must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('createPlatformAttestationVerifier(process.env)', 'buildSomethingElse(process.env)'), {}),
    [],
    'unpinning the platform router factory call must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(`${goodMain}\nconst v = new FailClosedAttestationVerifier();`, {}),
    [],
    'main.ts constructing a bare fail-closed class directly (instead of the router) must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(`${goodMain}\nconst pem = '-----BEGIN CERTIFICATE-----\n${'A'.repeat(48)}';`, {}),
    [],
    'embedded PEM certificate material in main.ts must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain, { 'src/familytrustset/evilPem.ts': `const pem = "-----BEGIN CERTIFICATE-----\n${'B'.repeat(48)}";` }),
    [],
    'embedded PEM certificate material anywhere in src must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(`${goodMain}\nconst pem = '-----BEGIN CERTIFICATE-----\\n${'A'.repeat(48)}';`, {}),
    [],
    'escaped-newline PEM certificate material in main.ts must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(`${goodMain}\n// see the -----BEGIN CERTIFICATE----- marker docs`, {}),
    [],
    'main.ts must not mention the PEM certificate marker even without material',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain, { 'src/familytrustset/evilPemEscaped.ts': `const pem = "-----BEGIN CERTIFICATE-----\\n${'C'.repeat(48)}";` }),
    [],
    'escaped-newline PEM certificate material anywhere in src must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('new FirstDeviceBootstrapService({', 'const disconnected = ('), {}),
    [],
    'unpinning the bootstrap service construction must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(`${goodMain}\nconst v = new StubAttestationVerifier();`, {}),
    [],
    'a permissive verifier token in main.ts must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(`${goodMain}\nconst v = new FakeAttestationVerifier();`, {}),
    [],
    'a fake verifier token in main.ts must be caught (Wave 6C extended bans)',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain, { 'src/familytrustset/evilVerifier.ts': 'export class StubAttestationVerifier {}' }),
    [],
    'a permissive verifier token anywhere in src must be caught',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain, { 'src/http/routes/evil.ts': 'import { TrustSetEpochAcceptance } from ...' }),
    [],
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain, { 'src/http/routes/evil2.ts': 'const r = new StoreBackedTrustSetRoleResolver();' }),
    [],
    'the resolver must stay out of routes even after the familytrustset import allowance',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain, { 'src/schedulerRunner.ts': 'const x = new TrustSetEpochAcceptance();' }),
    [],
  );
  assert.notDeepEqual(
    findFtsWiringViolations(`${goodMain}\nconst x = new TrustSetEpochAcceptanceService(deps);`, {}),
    [],
  );
  assert.notDeepEqual(findFtsWiringViolations(`${goodMain}\nawait store.appendAcceptedEpoch(record);`, {}), []);
  assert.notDeepEqual(findFtsWiringViolations(`${goodMain}\nawait store.appendAcceptedEpochOnConnection(conn, record, now);`, {}), []);
});

test('GENESIS APPEND WIRING GUARD: connection-scoped genesis writes stay out of routes', () => {
  const violations = findFtsWiringViolations('', {
    'src/http/routes/evil.ts': 'await store.appendGenesisEpochOnConnection(conn, record, now);',
  });
  assert.notDeepEqual(violations, []);
});

test('WAVE 6B ATOMIC SET: main.ts wires the store-backed resolver AND the fail-closed bootstrap lane, keeps the rejecting floor/verifier set, and no production path references the acceptance writer', () => {
  const mainText = read('src/main.ts');
  const sourceFiles = {};
  for (const file of listSourceFiles('src')) {
    if (file === 'src/main.ts') continue;
    sourceFiles[file] = readFileSync(path.join(backendRoot, file), 'utf8');
  }
  const violations = findFtsWiringViolations(mainText, sourceFiles);
  assert.deepEqual(violations, [], violations.join('; '));
});
