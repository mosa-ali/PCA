// PCA_PRODUCTION_PATH_CERTIFICATION -- an ENFORCED repository control.
//
// The rule this file exists to make unfalsifiable:
//   "Test passes" is not a certification unit. The certification unit is
//   production writer -> real dependency -> real reader/consumer, executed by
//   CI, under realistic repository state, including a populated database.
//
// WHY IT IS A TEST AND NOT A DOCUMENT. PCA-DEC-033 recorded that nothing
// enforced this rule, and that the failure mode which produced the whole
// remediation could therefore return silently. A recommendation in a register
// is not a control; the same was true of the schema-privacy allowlist, which
// had been RED since migration 0044 precisely because no workflow executed it.
// So the rule is encoded here, where it can fail a build.
//
// WHAT THIS FILE ACTUALLY ENFORCES, and -- just as important -- what it does
// NOT. Over-claiming enforcement would be the same false-assurance pattern this
// programme exists to remove, so the split is explicit:
//
//   MECHANICALLY ENFORCED (a build fails):
//     12. every durable store the production root constructs is registered
//         (so a NEW durable store cannot be added without a named
//         production-path test, and cannot be added as a silent gap)
//      1. each CERTIFIED entry names a test file AND a test name
//      2. that file really exists
//      3. that test name really appears in that file (verbatim substring)
//      4. that file is executed by a script CI actually invokes (resolved
//         transitively through package.json, so a script that merely calls
//         another script does not launder the claim)
//      5. that file contains no skip path, so a certified suite cannot report
//         itself skipped (the platform-admin privilege gate reported `# SKIP`
//         forever before this was noticed)
//      8/11. the register's own structure forces the writer, the reader and the
//         hostile-case question to be answered per entry
//     6/7. order- and emptiness-dependence is enforced EMPIRICALLY by the
//         `test:db:certified-twice` script, which re-runs the certified suites
//         against the SAME populated database. A test that only passes because
//         a table was near-empty fails there. This file cannot detect that
//         statically, and does not pretend to.
//
//   REVIEW-ONLY (documented here, judged by a human, NOT enforced):
//      9. writer output shape equals reader expectation
//     10. persisted value semantics are asserted
//     and the central claim of every CERTIFIED row -- that the named test
//     really drives the REAL writer rather than a double. No static check can
//     prove that; it is the reviewer's job, and the `realWriter` field is the
//     claim being reviewed.
//
// DB-free and fast, deliberately: it runs in the plain `npm test` pipeline, so
// the control is exercised on every push without needing MySQL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const BACKEND_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAIN_PATH = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const WORKFLOW_DIR = fileURLToPath(new URL('../../../.github/workflows', import.meta.url));

/**
 * Durable stores in the production composition root, by class name.
 *
 * `status: 'CERTIFIED'` requires `realWriter`, `realReader` (or an explicit
 * 'none' with a reason), `hostileCase`, `testFile` and `testName` -- all
 * mechanically checked above EXCEPT the claim that the test drives the real
 * writer, which is what a reviewer reads the `realWriter` field to judge.
 *
 * `status: 'GAP'` requires a `category` from the fixed set below and a `note`.
 * A gap is NOT a claim that the store is broken; it is a statement that it has
 * not been verified to this standard, with the reason. The four categories:
 *   NO_PRODUCTION_WRITER   -- nothing in src/ writes it (a feature that does
 *                             not work, not merely an untested one)
 *   SYNTHETIC_ONLY         -- the only tests construct the store directly
 *   NOT_EXECUTED_IN_CI     -- real-writer coverage exists but no workflow runs it
 *   CRYPTO_GATED           -- the writer is unreachable by design pending
 *                             PCA-DEC-020 (the composer/verifier rejects first)
 */
const REGISTER = new Map([
  [
    'MySqlActionIdempotencyLedger',
    {
      status: 'CERTIFIED',
      realWriter: 'ParentActionAuthorizationService.authorize -> record()',
      realReader: 'ParentActionAuthorizationService.authorize read-back, and the service-level replay path',
      hostileCase: 'malformed/over-long key rejected; a non-duplicate database failure is propagated, never absorbed',
      testFile: 'test/db/actionIdempotency.mysql.test.mjs',
      testName: 'REAL WRITER: the fingerprint ParentActionAuthorizationService actually produces is accepted by the durable column',
    },
  ],
  [
    'MySqlPlatformAdminAuditRepository',
    {
      status: 'CERTIFIED',
      realWriter: 'MySqlPlatformAdminAuditRepository.insert (via db/pool.js, as the least-privilege runtime principal)',
      realReader: 'MySqlPlatformAdminAuditRepository.queryForRole',
      hostileCase: 'the DB itself refuses UPDATE/DELETE for a principal holding the production grant plan, and the writer refuses an unknown event type',
      testFile: 'test/db/platformAdminAuditPrivileges.mysql.test.mjs',
      testName: 'PRODUCTION PATH: the real MySqlPlatformAdminAuditRepository writer and its queryForRole reader both work under the exact runtime grant plan production uses',
    },
  ],
  [
    'MySqlAuthRepository',
    {
      status: 'CERTIFIED',
      realWriter: 'AuthService (session issuance/validation)',
      realReader: 'AuthService session validation',
      hostileCase: 'token-hash uniqueness is DB-enforced',
      testFile: 'test/db/auth.mysql.test.mjs',
      testName: 'MySQL: issuing and validating a session persists through real MySQL',
    },
  ],
  [
    'MySqlAuthzRepository',
    {
      status: 'CERTIFIED',
      realWriter: 'AuthzService (family-scope authorization writes)',
      realReader: 'AuthzService.requiresFamilyScope',
      hostileCase: 'wrong family vs wrong account vs unknown scope are all rejected (IDOR checks against real MySQL)',
      testFile: 'test/db/authz.mysql.test.mjs',
      testName: 'MySQL: correct account/scope succeeds',
    },
  ],
  [
    'MySqlParentAccountRepository',
    {
      status: 'CERTIFIED',
      realWriter: 'ParentAccountService.register (registration + verification)',
      realReader: 'ParentAccountService lookups by email hash',
      hostileCase: 'two concurrent registrations for one email resolve to a single row, DB-uniqueness-enforced',
      testFile: 'test/db/parentAccount.mysql.test.mjs',
      testName: 'MySQL: registration persists a PENDING_VERIFICATION row, findable by email hash',
    },
  ],

  // ---- GAPS -----------------------------------------------------------------
  // Each is tracked, not hidden, and the ratchet test below stops the count from
  // growing. The evidence for each category is the store-vs-writer inventory
  // cross-referenced in PCA-DEC-034 (Section A = no writer, Section B =
  // synthetic-only, Section C = not executed in CI).
  ['MySqlFamilyRbacPolicyConfigRepository', { status: 'GAP', category: 'NO_PRODUCTION_WRITER', note: 'setForFamily/loadFamily have ZERO callers in src/, so per-family RBAC policy is never persisted and snapshotFor always returns the compiled default (PCA-DEC-034).' }],
  ['MySqlAdministrationPinRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'in-memory double only; no DB suite drives the service that writes it.' }],
  ['MySqlRemovalDecisionRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'in-memory double plus a source-text read; no DB suite drives RemovalDecisionAuthority into it.' }],
  ['MySqlGenesisChallengeRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'in-memory plus stubbed service; only a main.ts regex asserts composition.' }],
  ['MySqlGenesisStepUpRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'in-memory plus stubbed service.' }],
  ['MySqlGenesisTransactionRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'in-memory plus stubbed service.' }],
  ['MySqlFamilyAuthorityRequestChallengeRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'no test at all; its only caller is FamilyAuthorityRequestChallengeService.' }],
  ['MySqlParentPreferenceRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'hand-built fake in the route suite.' }],
  ['MySqlSafeZoneRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'hand-built fake in the route suite.' }],
  ['MySqlDeviceProtectionStatusRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'repository-direct writes; the real service is not driven.' }],
  ['MySqlProfileModeRepository', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'repository-direct writes in profileProtectionMode.mysql.test.mjs; the real service that owns the transition is not driven.' }],
  ['MySqlDeleteNowLedger', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'the delete PLAN is hand-built in 5 of 6 cases; the real planner is not driven into it.' }],
  ['MySqlInvitationRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage via InvitationService exists in invitation.mysql.test.mjs.' }],
  ['MySqlEnrollmentCoordinatorRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage via EnrollmentCoordinator exists in enrollment.mysql.test.mjs.' }],
  ['MySqlDeviceRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage exists in device.mysql.test.mjs.' }],
  ['MySqlRelayRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage exists in relay.mysql.test.mjs.' }],
  ['MySqlReleaseRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage exists in release.mysql.test.mjs.' }],
  ['MySqlChildProfileRegistryRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'synthetic DB suite plus a real-route suite in childProfileInvitationBindingHttp.mysql.test.mjs.' }],
  ['MySqlFamilyMemberInvitationRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage inside parentAccount.mysql.test.mjs.' }],
  ['MySqlEyeProtectionSettingsRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'synthetic DB suite plus a real-route suite in eyeProtectionSettingsHttp.mysql.test.mjs.' }],
  ['MySqlEntitlementRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage via EntitlementService exists in platformEntitlements*.mysql.test.mjs.' }],
  ['MySqlChangeRequestRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage via ChangeRequestService exists in platformEntitlements*.mysql.test.mjs.' }],
  ['MySqlSlotReservationRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage exists, but the RESERVED->CONSUMED hook has no production caller (PCA-DEC-031).' }],
  ['MySqlComplimentaryGrantRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'mixed real-writer coverage in complimentaryGrants.mysql.test.mjs.' }],
  ['MySqlFreeAccessAccountRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'coverage in freeAccessEnforcement.mysql.test.mjs.' }],
  ['MySqlSettlementRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage via SettlementService in settlement.mysql.test.mjs.' }],
  ['MySqlEmailOutboxRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'mixed: synthetic store-direct cases plus real EmailService cases.' }],
  ['MySqlFamilyAuthorityGenesisStore', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'real-writer coverage, but with a TEST-ONLY signature verifier rather than the production one.' }],
  ['MySqlFamilyAuthorityAttestationChainStore', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'same: test-only verifier; the production verifier is rejecting, so production never writes it.' }],
  ['MySqlDeviceChallengeRepository', { status: 'GAP', category: 'CRYPTO_GATED', note: 'the production device-signature verifier rejects unconditionally pending PCA-DEC-020.' }],
  ['MySqlEnvelopeAcceptanceTransaction', { status: 'GAP', category: 'CRYPTO_GATED', note: 'RejectingEnvelopeSignatureVerifier + rejecting context resolver make no production write reachable.' }],
  ['MySqlMessageIdempotencyLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'reached only through envelope acceptance, which the rejecting verifier blocks.' }],
  ['MySqlReplayLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'same: no production envelope is accepted, so nothing is recorded.' }],
  ['MySqlDataVersionLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'reached only through the same envelope-acceptance path, which the rejecting signature verifier blocks.' }],
  ['MySqlSequenceProgressLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'reached only through the same envelope-acceptance path; no production envelope is accepted, so no sequence is recorded.' }],
  ['MySqlFamilyAuditEventLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'the crypto-bound composer throws first, so delivery records nothing.' }],
  ['MySqlProtectionAlertLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'same rejecting composer shape as the audit ledger.' }],
  ['MySqlCommercialNotificationPublisher', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'coverage in commercialNotifications*.mysql.test.mjs.' }],
  ['MySqlCommercialMaintenanceRunner', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'coverage in commercialMaintenance.mysql.test.mjs.' }],
  ['MySqlPlatformAdminAuthRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'coverage in platformadmin.mysql.test.mjs; the MFA/step-up suites are the highest-value ones currently absent from CI.' }],
  ['MySqlPlatformAdminActivationRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'audited as real-writer AND in CI via platformAdminBootstrap, but the exact test name was not re-verified when this register was written, so it is tracked rather than claimed.' }],
  ['MySqlPlatformAdminAlertAdapter', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'coverage in platformAdminAlerts.mysql.test.mjs.' }],
  ['MySqlOwnerParentDeviceResolver', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'resolves the Owner device only (documented KNOWN GAP, PCA-DEC-031); coverage in protectionAlerts.mysql.test.mjs.' }],
  ['MySqlFamilyMembershipRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'covered through parentAccount.mysql.test.mjs.' }],
  ['MySqlFamilyMemberAccountBinder', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'covered through parentAccount.mysql.test.mjs.' }],
]);

/** The gap count may only go DOWN. See the ratchet test. */
const BASELINE_GAP_COUNT = 45;

const GAP_CATEGORIES = new Set([
  'NO_PRODUCTION_WRITER',
  'SYNTHETIC_ONLY',
  'NOT_EXECUTED_IN_CI',
  'CRYPTO_GATED',
]);

function durableStoresConstructedIn(mainSource) {
  const names = new Set();
  for (const match of mainSource.matchAll(/new\s+(MySql[A-Za-z0-9_]*)\s*\(/g)) names.add(match[1]);
  return names;
}

/** Constructed stores with no register row. Pure, so the negative control below can exercise it on synthetic input. */
function unregisteredStores(constructedStores, register) {
  const registered = new Set([...register.keys()]);
  return [...constructedStores].filter((name) => !registered.has(name)).sort();
}

/** Register rows describing something the production root no longer constructs. Pure, same reason. */
function staleRegisterRows(constructedStores, register) {
  return [...register.keys()].filter((name) => !constructedStores.has(name)).sort();
}

/**
 * Which test files CI actually executes. Resolved transitively on purpose: a
 * workflow that calls `npm run test:db:pa1` does not execute the DB suite unless
 * that script itself invokes something that does, and "some other script
 * probably covers it" is exactly the reasoning that left 53 suites unexecuted.
 */
function ciExecutedTestFiles() {
  const workflowSources = readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => readFileSync(`${WORKFLOW_DIR}/${name}`, 'utf8'));
  const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
  const scripts = packageJson.scripts ?? {};

  const invoked = new Set();
  const queue = [];
  for (const source of workflowSources) {
    for (const match of source.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) queue.push(match[1]);
  }
  while (queue.length > 0) {
    const name = queue.pop();
    if (invoked.has(name)) continue;
    invoked.add(name);
    const command = scripts[name];
    if (typeof command !== 'string') continue;
    for (const match of command.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) queue.push(match[1]);
  }

  const files = new Set();
  for (const name of invoked) {
    const command = scripts[name];
    if (typeof command !== 'string') continue;
    for (const match of command.matchAll(/(test\/[A-Za-z0-9._/-]+\.(?:test|spec)\.mjs)/g)) files.add(match[1]);
  }
  return { invoked, files };
}

const mainSource = readFileSync(MAIN_PATH, 'utf8');
const constructed = durableStoresConstructedIn(mainSource);
const ci = ciExecutedTestFiles();

test('NEGATIVE CONTROL: the register checks really do detect an unregistered store and a stale row', () => {
  // Without this, the two checks above could pass because they inspect nothing.
  // Same discipline the in-memory-store register uses: prove the detector fires
  // on input that SHOULD be caught, not just that it is silent on real input.
  const syntheticRegister = new Map([
    ['MySqlKept', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'synthetic control row' }],
    ['MySqlRemoved', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'synthetic control row' }],
  ]);
  assert.deepEqual(unregisteredStores(new Set(['MySqlKept', 'MySqlBrandNew']), syntheticRegister), ['MySqlBrandNew']);
  assert.deepEqual(staleRegisterRows(new Set(['MySqlKept']), syntheticRegister), ['MySqlRemoved']);
  assert.deepEqual(unregisteredStores(new Set(['MySqlKept']), syntheticRegister), []);
  assert.deepEqual(staleRegisterRows(new Set(['MySqlKept', 'MySqlRemoved']), syntheticRegister), []);
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 12: every durable store the production root constructs is registered', () => {
  const unregistered = unregisteredStores(constructed, REGISTER);
  assert.deepEqual(
    unregistered,
    [],
    'a durable MySQL-backed store is constructed in src/main.ts with no entry in this register. Add one: either\n' +
      'CERTIFIED (naming the real writer, the real reader, a hostile case, and a CI-executed test that drives it)\n' +
      'or GAP with one of the fixed categories. Do NOT add a GAP row merely to make this pass -- a new durable\n' +
      'store with no production-path test is precisely what this gate exists to stop:\n' +
      unregistered.join(', '),
  );
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 12: every register row still describes something the production root constructs (no stale rows)', () => {
  const stale = staleRegisterRows(constructed, REGISTER);
  assert.deepEqual(stale, [], `register rows no longer constructed in main.ts: ${stale.join(', ')}`);
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 1-5: every CERTIFIED row names a real test that CI really executes, with no skip path', () => {
  const certified = [...REGISTER.entries()].filter(([, entry]) => entry.status === 'CERTIFIED');
  assert.ok(certified.length > 0, 'the certified set must not be empty -- an empty set would make this gate vacuous');

  for (const [store, entry] of certified) {
    for (const field of ['realWriter', 'realReader', 'hostileCase', 'testFile', 'testName']) {
      assert.equal(
        typeof entry[field],
        'string',
        `${store} is CERTIFIED but does not state '${field}'. All five are required, because the reviewer has to be able to read the claim and the evidence for it.`,
      );
      assert.ok(entry[field].length > 10, `${store}.${field} is too short to be a real claim`);
    }

    // Gate 2: the file exists and is where it says it is.
    let contents;
    try {
      contents = readFileSync(`${BACKEND_ROOT}${entry.testFile}`, 'utf8');
    } catch {
      assert.fail(`${store} names ${entry.testFile}, which does not exist`);
    }

    // Gate 3: the named test is really in that file, verbatim.
    assert.ok(
      contents.includes(entry.testName),
      `${store} names a test that does not appear in ${entry.testFile}: "${entry.testName}"`,
    );

    // Gate 4: CI executes that file.
    assert.ok(
      ci.files.has(entry.testFile),
      `${store}'s test file ${entry.testFile} is not executed by any script CI invokes. ` +
        `Scripts CI invokes: ${[...ci.invoked].sort().join(', ')}`,
    );

    // Gate 5 (static half): no UNCONDITIONAL skip. A certified suite that can
    // unconditionally report itself skipped is not certified.
    //
    // The empirical half is the one that matters and it lives in
    // scripts/run-certified-production-paths.mjs, which re-runs every certified
    // file against the SAME populated database and fails unless it reports
    // `# skipped 0` and `# fail 0`. It is empirical because a static literal
    // check cannot tell a legitimate conditional skip from a hiding place: this
    // gate's first version flagged platformAdminAuditPrivileges.mysql.test.mjs,
    // whose `{ skip: reason }` branch is CORRECT -- that file runs for real in CI
    // (the job sets PCA_MIGRATION_DATABASE_URL) and only skips in a credential-free
    // local run. Asserting on the absence of a skip STRING would have forced a
    // choice between a false failure and weakening the gate; asserting on the
    // OBSERVED skip COUNT enforces the requirement as actually stated.
    assert.doesNotMatch(
      contents,
      /\btest\.skip\s*\(|\bit\.skip\s*\(|\bdescribe\.skip\s*\(|\btest\.todo\s*\(/,
      `${store}'s certified test file contains an unconditional skip path. A certified suite must not be able to report itself skipped.`,
    );
  }
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 8/11: every GAP row carries a category from the fixed set and a real note', () => {
  for (const [store, entry] of REGISTER) {
    if (entry.status !== 'GAP') continue;
    assert.ok(
      GAP_CATEGORIES.has(entry.category),
      `${store} has category '${entry.category}', which is not one of ${[...GAP_CATEGORIES].join(', ')}. ` +
        'A free-text category cannot be audited or counted.',
    );
    assert.ok(
      typeof entry.note === 'string' && entry.note.length > 30,
      `${store} is a GAP with no real note. State WHY, with evidence -- an unexplained gap is indistinguishable from an oversight.`,
    );
  }
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 4: the certified file list in the runner matches this register exactly', () => {
  // The certified files are executed as their own script so the empirical gates
  // (zero skips, populated-database independence) have one list to run against.
  // That list is the runner's, and it is cross-checked here so the two cannot
  // drift: a store certified in this register but absent from the runner would
  // never actually be re-run, and would be certified on paper only.
  const runnerSource = readFileSync(fileURLToPath(new URL('../../scripts/run-certified-production-paths.mjs', import.meta.url)), 'utf8');
  const scripted = new Set([...runnerSource.matchAll(/'(test\/[A-Za-z0-9._/-]+\.(?:test|spec)\.mjs)'/g)].map((match) => match[1]));
  const registered = new Set(
    [...REGISTER.values()].filter((entry) => entry.status === 'CERTIFIED').map((entry) => entry.testFile),
  );
  assert.deepEqual(
    [...scripted].sort(),
    [...registered].sort(),
    'the certified files in scripts/run-certified-production-paths.mjs and the CERTIFIED rows in this register have diverged. ' +
      'Certifying a store means adding its test file to that runner as well, so the empirical gates actually run against it.',
  );
});

test('PCA_PRODUCTION_PATH_CERTIFICATION: the uncertified count may only go DOWN (ratchet)', () => {
  // The ratchet is the control, not the count. Equality rather than `<=` on
  // purpose: closing a gap then requires LOWERING this number, so progress is
  // always a deliberate, reviewable edit; and ADDING a gap requires RAISING it,
  // which is a visible red flag in review rather than a silent regression. A
  // `<=' would let the baseline sit stale forever while gaps accumulated under it.
  const gaps = [...REGISTER.values()].filter((entry) => entry.status === 'GAP');
  assert.equal(
    gaps.length,
    BASELINE_GAP_COUNT,
    `the uncertified gap count changed (${gaps.length} vs baseline ${BASELINE_GAP_COUNT}). ` +
      'If you CERTIFIED a store: lower BASELINE_GAP_COUNT in the same commit -- that is the record of progress. ' +
      'If you ADDED a store: it must arrive CERTIFIED, not as a new gap.',
  );
  // And the breakdown, so the shape of the remaining work is visible in CI output
  // rather than inferable only by reading the table.
  const byCategory = {};
  for (const entry of gaps) byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  console.log(
    `PCA_PRODUCTION_PATH_CERTIFICATION: ${REGISTER.size - gaps.length} certified, ${gaps.length} tracked gaps ` +
      `(${Object.entries(byCategory).sort().map(([category, count]) => `${category}=${count}`).join(' ')})`,
  );
});
