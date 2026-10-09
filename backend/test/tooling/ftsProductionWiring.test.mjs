// PCA mobile authority production-wiring guard.
//
// Ordinary signed Trust Set acceptance is composed in main.ts from durable
// epoch/key/floor stores, the genesis anchor source, and the strict P-256
// verifier. Keep that production path pinned to the shared accepted epoch
// store and OrdinaryTrustSetService, and keep it out of route modules.
// Envelope-context verification remains independently rejecting; this
// ordinary device-session path must not silently activate that authority.
//
// First-device trust-root bootstrap remains a separate lane behind the
// configured platform attestation router. Permissive attestation verifier
// tokens and compiled-in PEM roots remain banned.
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

  // 1. The store-backed resolver is the ONE production resolver. Persisted
  //    epoch bytes must be checked against the active device/key directory
  //    and the same strict verifier used by acceptance.
  const resolverMatch = mainText.match(/new StoreBackedTrustSetRoleResolver\(\{([\s\S]*?)\}\)/);
  if (!resolverMatch) {
    violations.push('main.ts must construct exactly one store-backed trust-set role resolver');
  } else {
    for (const pin of ['epochStore: trustSetEpochStore', 'deviceRepository', 'verifier: trustSetSignatureVerifier']) {
      if (!resolverMatch[1].includes(pin)) {
        violations.push(`store-backed role resolver must receive ${pin}`);
      }
    }
  }
  if ((mainText.match(/new StoreBackedTrustSetRoleResolver\(/g) || []).length !== 1) {
    violations.push('main.ts must construct exactly one store-backed trust-set role resolver');
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

  // 2b. Ordinary signed epoch acceptance is a production path, but it must
  //     use the shared durable epoch store and strict verifier composition.
  for (const pin of [
    'const trustSetEpochStore = new MySqlTrustSetEpochStore();',
    'const trustSetSignatureVerifier = new P256TrustSetSignatureVerifier();',
    'new TrustSetEpochAcceptanceService({',
    'epochStore: trustSetEpochStore,',
    'keyEpochStore: new MySqlKeyEpochStore(),',
    'floorStore: new MySqlEpochFloorStore(),',
    'genesisAnchorSource: new GenesisAnchorStoreSource(new MySqlFamilyAuthorityGenesisStore()),',
    'verifier: trustSetSignatureVerifier,',
    'new OrdinaryTrustSetService(',
    'ordinaryTrustSetService,',
  ]) {
    if (!mainText.includes(pin)) {
      violations.push('main.ts must keep the ordinary Trust Set acceptance wiring pin: ' + pin);
    }
  }
  if (!/const ordinaryTrustSetService = new OrdinaryTrustSetService\(\s*trustSetEpochAcceptanceService,\s*trustSetRoleResolver,\s*\);/s.test(mainText)) {
    violations.push('main.ts must inject the shared verified Trust Set role resolver into OrdinaryTrustSetService');
  }
  if ((mainText.match(/new TrustSetEpochAcceptanceService\(/g) || []).length !== 1) {
    violations.push('main.ts must construct exactly one ordinary Trust Set acceptance service');
  }
  for (const forbidden of [
    '.appendAcceptedEpoch(',
    'appendAcceptedEpochOnConnection',
    'appendGenesisEpochOnConnection',
    'decodeCanonicalTrustSetEpoch',
  ]) {
    if (mainText.includes(forbidden)) {
      violations.push('main.ts must delegate acceptance to OrdinaryTrustSetService, not call ' + forbidden);
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
  //    referenced by main.ts's production composition only as allowed below.
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

test('GATE SELF-TEST: the checker detects partial ordinary acceptance and bootstrap compositions', () => {
  const goodMain = [
    'const trustSetEpochStore = new MySqlTrustSetEpochStore();',
    'const trustSetSignatureVerifier = new P256TrustSetSignatureVerifier();',
    'const trustSetRoleResolver = new StoreBackedTrustSetRoleResolver({',
    '  epochStore: trustSetEpochStore,',
    '  deviceRepository,',
    '  verifier: trustSetSignatureVerifier,',
    '});',
    'const trustSetEpochAcceptanceService = new TrustSetEpochAcceptanceService({',
    '  epochStore: trustSetEpochStore,',
    '  keyEpochStore: new MySqlKeyEpochStore(),',
    '  floorStore: new MySqlEpochFloorStore(),',
    '  genesisAnchorSource: new GenesisAnchorStoreSource(new MySqlFamilyAuthorityGenesisStore()),',
    '  verifier: trustSetSignatureVerifier,',
    '});',
    'const ordinaryTrustSetService = new OrdinaryTrustSetService(',
    '  trustSetEpochAcceptanceService,',
    '  trustSetRoleResolver,',
    ');',
    'const platformAttestationVerifier = createPlatformAttestationVerifier(process.env);',
    'const firstDeviceBootstrapService = new FirstDeviceBootstrapService({',
    '  store: new MySqlFirstDeviceBootstrapStore({ epochStore: trustSetEpochStore }),',
    '  attestationVerifier: platformAttestationVerifier,',
    '});',
    'firstDeviceBootstrapService,',
    'ordinaryTrustSetService,',
    'resolveEnvelopeContext: rejectingResolveEnvelopeContext,',
    'RejectingEnvelopeSignatureVerifier',
    'RejectingDeviceSignatureVerifier',
  ].join('\n');
  assert.deepEqual(findFtsWiringViolations(goodMain, {}), []);

  // Each mutation of the frozen set must be reported.
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('new StoreBackedTrustSetRoleResolver({', 'new UnavailableTrustSetRoleResolver({'), {}),
    [],
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('verifier: trustSetSignatureVerifier,', 'verifier: otherVerifier,'), {}),
    [],
    'persisted role resolution must share the strict production signature verifier',
  );
  assert.notDeepEqual(
    findFtsWiringViolations(goodMain.replace('  trustSetRoleResolver,', '  undefined,'), {}),
    [],
    'the ordinary Trust Set service must receive the shared role resolver',
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

test('PRODUCTION SET: ordinary signed acceptance is wired safely while bootstrap and envelope boundaries stay pinned', () => {
  const mainText = read('src/main.ts');
  const sourceFiles = {};
  for (const file of listSourceFiles('src')) {
    if (file === 'src/main.ts') continue;
    sourceFiles[file] = readFileSync(path.join(backendRoot, file), 'utf8');
  }
  const violations = findFtsWiringViolations(mainText, sourceFiles);
  assert.deepEqual(violations, [], violations.join('; '));
});
