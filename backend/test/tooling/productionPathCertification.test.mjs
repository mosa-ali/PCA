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
//     6/7. order- and emptiness-dependence is enforced EMPIRICALLY by
//         `npm run test:db:certified-paths`
//         (scripts/run-certified-production-paths.mjs), which re-runs the
//         certified scope against the SAME populated database. A test that only
//         passes because a table was near-empty fails there. This file cannot
//         detect that statically, and does not pretend to. (An earlier revision
//         of this header named a `test:db:certified-twice` script that has never
//         existed -- a documentation claim in a control, which is the same
//         false-assurance pattern the control exists to remove. The names in
//         this header are now taken from package.json.)
//
//   REVIEW-ONLY (documented here, judged by a human, NOT enforced):
//      9. writer output shape equals reader expectation
//     10. persisted value semantics are asserted
//     and the central claim of every CERTIFIED row -- that the named test
//     really drives the REAL writer rather than a double. No static check can
//     prove that; it is the reviewer's job, and the `realWriter` field is the
//     claim being reviewed.
//
// WHY THE `NOT_EXECUTED_IN_CI` CATEGORY NOW NEEDS READING CAREFULLY. It was
// accurate when the register was written: most of the 62 DB suites had no CI
// job at all. Wiring the full suite into the FULL DB job (PCA-DEC-033) fixed
// that, so for those rows the category name is now literally FALSE -- their
// files do execute in CI. It survives only as shorthand for "execution is no
// longer the missing property; the missing property is proof that the named
// test drives the real writer and the real consumer", and every such row must
// end either CERTIFIED (proof present) or re-categorised (`SYNTHETIC_ONLY` when
// the only coverage is a double, `NO_PRODUCTION_WRITER` when nothing writes the
// store in production at all). It is being retired row by row on evidence, NOT
// reclassified in bulk: renaming 24 rows would change the count without changing
// the assurance, which is precisely what the ratchet is written to forbid.
//
// DB-free and fast, deliberately: it runs in the plain `npm test` pipeline, so
// the control is exercised on every push without needing MySQL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateCertificationRun } from '../../scripts/lib/certificationRunVerdict.mjs';

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
  ['MySqlFamilyRbacPolicyConfigRepository', { status: 'GAP', category: 'NO_PRODUCTION_WRITER', note: 'TWO independent gaps, not one. (a) NO WRITER: setForFamily/loadFamily have ZERO callers in src/**, so no policy row is ever persisted and snapshotFor always returns the compiled default. (b) THE CONSUMER DISCARDS IT: resolveOperationAuthorization does not read config at all -- ALLOW_IF_CONFIGURED_WITH_STEP_UP is never used as a matrix cell -- and test/familyrbac/policy.test.mjs PROVES the insensitivity by feeding maximally-permissive and maximally-restrictive configs and asserting identical verdicts. Consequence: the four operations doc 18 Section 2 marks "configurable ... safe default is off" (ADD_VIEWER, REMOVE_NON_OWNER_PARENT, REMOVE_REVOKE_DEVICE, DISABLE_PROTECTION_POLICY) are hard-coded ALLOW_WITH_STEP_UP for ADMINISTRATOR, so the EFFECTIVE default is ON while the documented default is OFF. A writer alone would change nothing observable, so this row must NOT be closed by wiring one, and must NOT be closed by flipping the cells to fail-closed either (with no writer, no Owner could turn the capability back on). Doc 18 Section 2 also requires the policy configuration to be "itself E2EE, signed, and auditable"; the existing repository writes plaintext booleans with no signature and no audit event. Owner ruling required -- see PCA-DEC-034.' }],
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
  ['MySqlFamilyMemberInvitationRepository', {
    status: 'CERTIFIED',
    realWriter: 'FamilyMemberInvitationService.acceptInvitation -> MySqlFamilyMemberInvitationRepository.acceptAtomically',
    realReader: 'MySqlFamilyMemberInvitationRepository.findByIdForFamily, read back after the service returns',
    hostileCase: 'two independent failure paths: a non-addressee with a valid account gets NOT_FOUND and the row stays PENDING (and an ACCEPTED invitation is indistinguishable from one that never existed); and an entitlement-ledger failure during acceptance rolls the whole transaction back, leaving PENDING and charging zero seats',
    testFile: 'test/db/parentAccount.mysql.test.mjs',
    testName: 'accepting a family-member invitation consumes exactly one parent-member seat, in the SAME transaction as the invitation transition',
  }],
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
  ['MySqlFamilyMembershipRepository', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'CORRECTED NOTE (the previous one named parentAccount.mysql.test.mjs as its coverage; that file never names or constructs this class). It has ZERO direct test coverage -- searching every test/**/*.mjs finds it only in the certification register itself. Production-reachable in two places: MySqlParentAccountRepository holds a private instance and forwards createGenesisAdministrator/applyAcceptedInvitationRole/applyAcceptedInvitationRoleOnConnection/findActiveRole to it, and MySqlFamilyMemberAccountBinder default-constructs it. So coverage is at best INDIRECT, through the delegating parent-account repository, and the genesis delegate is not indirect-covered at all: the one suite that would exercise it, parentAccount.mysql.test.mjs, contains an explicit test that verify-email does NOT create family authority before the separate DSK genesis ceremony. Needs a real DB suite that drives the delegating caller, not a note that claims one exists.' }],
  ['MySqlFamilyMemberAccountBinder', { status: 'GAP', category: 'NOT_EXECUTED_IN_CI', note: 'VERIFIED CLOSER TO CERTIFIED THAN THE PREVIOUS NOTE SUGGESTED, but blocked on one specific missing property rather than on CI execution. parentAccount.mysql.test.mjs DOES construct the real MySqlFamilyMemberAccountBinder, inject it into the real FamilyMemberInvitationService, and assert its durable effect through a direct DB read of parent_accounts.family_id ("the real MySqlFamilyMemberAccountBinder must have durably bound the member"). What it lacks is a hostile or failure-path case: the binder is exercised only on the success path (the documented best-effort bind outside acceptAtomically\'s transaction), so nothing tests what a failed or partial bind leaves behind. Certify it once a failure-path assertion exists, not before.' }],
]);

/** The gap count may only go DOWN. See the ratchet test. */
const BASELINE_GAP_COUNT = 44;

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

// ---------------------------------------------------------------------------
// PURE CHECKERS. Each returns a list of problem strings; empty means the input
// satisfies that gate. They are pure and take their file-reading and CI-file-set
// as PARAMETERS specifically so the negative control below can feed them input
// that SHOULD fail. A gate that cannot be shown to fail on the defect class it
// claims to prevent is not known to enforce anything.
// ---------------------------------------------------------------------------

/** Gate 12: stores the production root constructs with no register row. */
function registrationProblems(constructedStores, register) {
  const registered = new Set([...register.keys()]);
  return [...constructedStores]
    .filter((name) => !registered.has(name))
    .sort()
    .map((name) => `${name} is constructed in src/main.ts but has no register row`);
}

/** Gate 12: register rows describing a store the production root no longer constructs. */
function staleRowProblems(constructedStores, register) {
  return [...register.keys()]
    .filter((name) => !constructedStores.has(name))
    .sort()
    .map((name) => `${name} has a register row but is no longer constructed in src/main.ts`);
}

/**
 * Gates 1-5 for ONE certified row: the five claims must be stated, the file must
 * exist, the named test must appear in it verbatim, CI must execute it, and it
 * must not contain an unconditional skip.
 */
function certifiedRowProblems(store, entry, { readFile, ciFiles }) {
  const problems = [];
  for (const field of ['realWriter', 'realReader', 'hostileCase', 'testFile', 'testName']) {
    if (typeof entry[field] !== 'string') {
      problems.push(`${store} is CERTIFIED but does not state '${field}'`);
    } else if (entry[field].length <= 10) {
      problems.push(`${store}.${field} is too short to be a real claim`);
    }
  }
  if (problems.length > 0) return problems; // nothing below can be evaluated meaningfully

  let contents;
  try {
    contents = readFile(entry.testFile);
  } catch {
    return [`${store} names ${entry.testFile}, which does not exist`];
  }
  if (!contents.includes(entry.testName)) {
    problems.push(`${store} names a test that does not appear in ${entry.testFile}: "${entry.testName}"`);
  }
  if (!ciFiles.has(entry.testFile)) {
    problems.push(`${store}'s test file ${entry.testFile} is not executed by any script CI invokes`);
  }
  if (/\btest\.skip\s*\(|\bit\.skip\s*\(|\bdescribe\.skip\s*\(|\btest\.todo\s*\(/.test(contents)) {
    problems.push(`${store}'s certified test file contains an unconditional skip path`);
  }
  return problems;
}

/** Gates 8/11 for one gap row: a category from the fixed set, and a note that states a real reason. */
function gapRowProblems(store, entry, gapCategories) {
  const problems = [];
  if (!gapCategories.has(entry.category)) {
    problems.push(`${store} has category '${entry.category}', which is not one of ${[...gapCategories].join(', ')}`);
  }
  if (typeof entry.note !== 'string' || entry.note.length <= 30) {
    problems.push(`${store} is a GAP with no real note stating why`);
  }
  return problems;
}

/** The ratchet: the gap count must equal the recorded baseline exactly. */
function ratchetProblems(register, baselineGapCount) {
  const gaps = [...register.values()].filter((entry) => entry.status === 'GAP');
  return gaps.length === baselineGapCount
    ? []
    : [`the uncertified gap count is ${gaps.length} but the baseline is ${baselineGapCount}`];
}

const mainSource = readFileSync(MAIN_PATH, 'utf8');
const constructed = durableStoresConstructedIn(mainSource);
const ci = ciExecutedTestFiles();
const readRealFile = (testFile) => readFileSync(`${BACKEND_ROOT}${testFile}`, 'utf8');

test('GATE SELF-TEST: every check in this file is demonstrated to FAIL on the defect class it claims to prevent', () => {
  // The permanent principle: an enforcement gate must itself be shown to fail.
  // This file's first version broke exactly this rule -- it enforced a LEXICAL
  // proxy (the absence of a skip STRING) rather than the property (SKIP_COUNT =
  // 0), looked stricter, and produced a false positive on a correctly-conditional
  // skip. A gate whose failure modes are untested is indistinguishable from a
  // gate that cannot fail.
  //
  // Each block below feeds a checker input that MUST be rejected, and asserts the
  // rejection names the right thing. `readFile` and `ciFiles` are injected so the
  // certified-row checks can be exercised without touching the real filesystem.
  const ciFiles = new Set(['test/db/ok.mysql.test.mjs']);
  // Fixture contents deliberately CONTAIN the verbatim test name, so each case
  // isolates the one gate under test instead of tripping gate 3 as a side effect.
  const okContents = 'test("a real test name", () => {});';
  const baseCertified = {
    status: 'CERTIFIED',
    realWriter: 'RealWriter.method',
    realReader: 'RealReader.method',
    hostileCase: 'a hostile case is asserted',
    testFile: 'test/db/ok.mysql.test.mjs',
    testName: 'a real test name',
  };
  const certProblems = (overrides = {}, fileContents, options = {}) =>
    certifiedRowProblems('MySqlSynthetic', { ...baseCertified, ...overrides }, {
      readFile: options.missingFile ? () => { throw new Error('ENOENT'); } : () => fileContents ?? okContents,
      ciFiles: options.ciFiles ?? ciFiles,
    });

  // Gate 1: a missing or too-short claim.
  assert.ok(certProblems({ realWriter: undefined }).some((p) => p.includes("does not state 'realWriter'")), 'gate 1 must catch a missing claim');
  assert.ok(certProblems({ hostileCase: 'too short' }).some((p) => p.includes('too short')), 'gate 1 must catch a non-claim');

  // Gate 2: the named file does not exist.
  assert.ok(certProblems({}, undefined, { missingFile: true }).some((p) => p.includes('does not exist')), 'gate 2 must catch a missing file');

  // Gate 3: the named test is not in the file.
  assert.ok(certProblems({}, 'nothing resembling the name').some((p) => p.includes('does not appear in')), 'gate 3 must catch an absent test name');

  // Gate 4: the file is not executed by any CI-invoked script.
  assert.ok(certProblems({}, undefined, { ciFiles: new Set() }).some((p) => p.includes('not executed by any script CI invokes')), 'gate 4 must catch a file CI never runs');

  // Gate 5: an unconditional skip.
  assert.ok(certProblems({}, 'test.skip("a real test name", () => {});').some((p) => p.includes('unconditional skip')), 'gate 5 must catch test.skip');
  assert.ok(certProblems({}, 'describe.skip("a real test name", () => {});').some((p) => p.includes('unconditional skip')), 'gate 5 must catch describe.skip');
  // ...and must NOT flag the legitimate conditional form that this gate's first
  // version wrongly rejected.
  assert.deepEqual(certProblems({}, 'test("a real test name", { skip: reason }, () => {});'), [], 'gate 5 must not flag a legitimate conditional skip');

  // Gates 8/11: a bad category, and a note that states nothing.
  assert.ok(gapRowProblems('MySqlSynthetic', { status: 'GAP', category: 'MADE_UP', note: 'a note long enough to pass the length floor' }, GAP_CATEGORIES).some((p) => p.includes('MADE_UP')), 'the category check must catch an unknown category');
  assert.ok(gapRowProblems('MySqlSynthetic', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'too short' }, GAP_CATEGORIES).some((p) => p.includes('no real note')), 'the note check must catch an unexplained gap');

  // Gate 12: an unregistered store, a stale row, and the ratchet.
  assert.ok(registrationProblems(new Set(['MySqlBrandNew']), new Map()).length === 1, 'registration must catch an unregistered store');
  assert.ok(staleRowProblems(new Set(), new Map([['MySqlGone', { status: 'GAP' }]])).length === 1, 'stale-row detection must catch a removed store');
  assert.ok(ratchetProblems(new Map([['MySqlGone', { status: 'GAP' }]]), 2).length === 1, 'the ratchet must catch a count that does not match the baseline');
  assert.deepEqual(ratchetProblems(new Map([['MySqlGone', { status: 'GAP' }]]), 1), [], 'the ratchet must accept a matching count');

  // And the checkers must be silent on healthy input, or the self-test above
  // would be satisfied by a checker that rejects everything.
  assert.deepEqual(certProblems(), [], 'a healthy certified row must produce no problems');
  assert.deepEqual(gapRowProblems('MySqlSynthetic', { status: 'GAP', category: 'SYNTHETIC_ONLY', note: 'a real note with evidence pointing at the store' }, GAP_CATEGORIES), [], 'a healthy gap row must produce no problems');
  assert.deepEqual(registrationProblems(new Set(['MySqlKept']), new Map([['MySqlKept', { status: 'GAP' }]])), [], 'a fully registered store set must produce no problems');
});

test('GATE SELF-TEST: the empirical runner verdict FAILS on skipped, failed, empty and unparseable runs', () => {
  // The other half of the control -- scripts/run-certified-production-paths.mjs --
  // decides PASS/FAIL from the runner's summary. Those verdicts are the ones that
  // actually gate a certification, so each is attacked here with synthetic runner
  // output. Without this the runner could be permanently green through an inverted
  // comparison and nothing would notice: a real skip with the check inverted looks
  // identical to a clean run from the outside.
  const tap = ({ pass, fail, skipped }) =>
    `TAP version 13\n# tests ${pass + fail + skipped}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n`;

  // The happy path must pass, or every assertion below is satisfied by a verdict
  // function that rejects everything.
  const clean = evaluateCertificationRun({ output: tap({ pass: 57, fail: 0, skipped: 0 }), exitStatus: 0 });
  assert.deepEqual(clean.problems, [], 'a clean run must produce no problems');
  assert.equal(clean.passed, 57);

  // Gate 5: any skip at all, however small, must fail.
  const skipped = evaluateCertificationRun({ output: tap({ pass: 55, fail: 0, skipped: 2 }), exitStatus: 0 });
  assert.ok(skipped.problems.some((p) => p.includes('SKIPPED')), 'one skipped test must fail the certification');
  assert.equal(skipped.skipped, 2, 'the observed skip count must be reported, not just the fact of failure');

  // A real failure must fail, even when the exit status is 0.
  const failedRun = evaluateCertificationRun({ output: tap({ pass: 56, fail: 1, skipped: 0 }), exitStatus: 0 });
  assert.ok(failedRun.problems.some((p) => p.includes('FAILED')), 'a failed test must fail the certification');

  // An empty pass is not a certification -- a runner that selects nothing from the
  // certified scope must not be able to report success.
  const empty = evaluateCertificationRun({ output: tap({ pass: 0, fail: 0, skipped: 0 }), exitStatus: 0 });
  assert.ok(empty.problems.some((p) => p.includes('zero certified tests passed')), 'an empty pass must fail');

  // Unparseable output must be refused, NOT read as zeros: a crashed run has no
  // summary line, and 'no counts found' must never be treated as 'all counts are 0'.
  const unparseable = evaluateCertificationRun({ output: 'Error: cannot find module\n', exitStatus: 1 });
  assert.ok(unparseable.problems.some((p) => p.includes('unparseable')), 'unparseable output must be refused');
  assert.equal(unparseable.passed, null, 'absent counts must read as null, never as 0');

  // A non-zero exit is caught even when the summary looks healthy.
  const crashedAfterSummary = evaluateCertificationRun({ output: tap({ pass: 57, fail: 0, skipped: 0 }), exitStatus: 1 });
  assert.ok(crashedAfterSummary.problems.some((p) => p.includes('exited 1')), 'a non-zero exit must fail');
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 12: every durable store the production root constructs is registered', () => {
  const problems = registrationProblems(constructed, REGISTER);
  assert.deepEqual(
    problems,
    [],
    `${problems.join('\n')}\n\na durable MySQL-backed store is constructed in src/main.ts with no entry in this register. Add\n` +
      'one: either CERTIFIED (naming the real writer, the real reader, a hostile case, and a CI-executed test that\n' +
      'drives it) or GAP with one of the fixed categories. Do NOT add a GAP row merely to make this pass -- a new\n' +
      'durable store with no production-path test is precisely what this gate exists to stop.',
  );
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 12: every register row still describes something the production root constructs (no stale rows)', () => {
  const problems = staleRowProblems(constructed, REGISTER);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 1-5: every CERTIFIED row names a real test that CI really executes, with no skip path', () => {
  const certified = [...REGISTER.entries()].filter(([, entry]) => entry.status === 'CERTIFIED');
  assert.ok(certified.length > 0, 'the certified set must not be empty -- an empty set would make this gate vacuous');

  const problems = certified.flatMap(([store, entry]) => certifiedRowProblems(store, entry, { readFile: readRealFile, ciFiles: ci.files }));
  assert.deepEqual(
    problems,
    [],
    `${problems.join('\n')}\n\nA CERTIFIED row is a claim that a named test drives the real production writer into the\n` +
      `real dependency and reads back through the real consumer, and that CI executes it without skipping.\n` +
      `Scripts CI invokes: ${[...ci.invoked].sort().join(', ')}`,
  );
});

test('PCA_PRODUCTION_PATH_CERTIFICATION 8/11: every GAP row carries a category from the fixed set and a real note', () => {
  const problems = [...REGISTER.entries()]
    .filter(([, entry]) => entry.status === 'GAP')
    .flatMap(([store, entry]) => gapRowProblems(store, entry, GAP_CATEGORIES));
  assert.deepEqual(
    problems,
    [],
    `${problems.join('\n')}\n\nA gap must carry a category from the fixed set (a free-text category cannot be audited\n` +
      'or counted) and a note stating WHY with evidence -- an unexplained gap is indistinguishable from an oversight.',
  );
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

test('PCA_PRODUCTION_PATH_CERTIFICATION: the uncertified count may only go DOWN (ratchet), and only by real certification', () => {
  // The ratchet tracks QUANTITY AND QUALITY, not just the number. Equality rather
  // than `<=' on purpose: closing a gap requires LOWERING this baseline, so
  // progress is always a deliberate, reviewable edit, and adding a gap requires
  // RAISING it, which is a visible red flag rather than a silent regression.
  //
  // Crucially, a row can only leave the gap count by becoming CERTIFIED, and a
  // CERTIFIED row must pass every check above -- five stated claims, an existing
  // file, a verbatim test name, CI execution, no unconditional skip -- AND appear
  // in the certified-paths runner, which enforces zero skips against a populated
  // database. A number cannot improve while assurance weakens: lowering the
  // baseline without actually certifying the row leaves the count mismatched and
  // fails here.
  const problems = ratchetProblems(REGISTER, BASELINE_GAP_COUNT);
  assert.deepEqual(
    problems,
    [],
    `${problems.join('\n')}\n\nIf you CERTIFIED a store: lower BASELINE_GAP_COUNT in the same commit -- that is the record\n` +
      'of progress, and it must be accompanied by a CERTIFIED row passing every check in this file. If you ADDED a\n' +
      'store: it must arrive CERTIFIED, not as a new gap.',
  );
  const gaps = [...REGISTER.values()].filter((entry) => entry.status === 'GAP');
  const byCategory = {};
  for (const entry of gaps) byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  console.log(
    `PCA_PRODUCTION_PATH_CERTIFICATION: ${REGISTER.size - gaps.length} certified, ${gaps.length} tracked gaps ` +
      `(${Object.entries(byCategory).sort().map(([category, count]) => `${category}=${count}`).join(' ')})`,
  );
});
