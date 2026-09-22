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
  ['MySqlFamilyMemberAccountBinder', {
    status: 'CERTIFIED',
    // PCA-DEC-036 changed WHERE the bind happens, so the named writer path was
    // updated with it: the service no longer calls bindAccountToFamily after the
    // acceptance commits. It now passes
    // tryBindAccountToFamilyOnConnection as a hook that acceptAtomically invokes
    // on its OWN transaction connection, before commit -- which is what makes the
    // `WHERE family_id IS NULL` guard an authoritative precondition instead of an
    // advisory one. bindAccountToFamily still exists and still delegates here; it
    // is simply no longer this path.
    realWriter: 'FamilyMemberInvitationService.acceptInvitation -> MySqlFamilyMemberAccountBinder.tryBindAccountToFamilyOnConnection (invoked by MySqlFamilyMemberInvitationRepository.acceptInTransaction on the acceptance transaction\'s own connection, before commit), the real binder injected into the real service',
    realReader: 'readAccountFamilyId reads parent_accounts.family_id back after acceptance, and the membership row is read back from family_parent_memberships',
    hostileCase: 'BINDER CONTAINMENT (added to close this row): an account already bound to family A accepts a second, genuinely-addressed invitation for family B. The binder must refuse to move it -- the UPDATE is `WHERE family_id IS NULL` so it is a no-op, and the membership role is applied only when the row read back already carries the TARGET family. Asserts family_id is still A, that NO membership row exists for B, and that A\'s existing VIEWER membership survives with its role NOT silently upgraded to the ADMINISTRATOR the second invitation offered. UPDATED by PCA-DEC-036 (the previous note recorded the family-B invitation BEING consumed as "an observation, not endorsed"; that is now fixed, so the test asserts the opposite): the refusal is distinguishable (FAMILY_CONFLICT), the family-B invitation stays PENDING with no acceptance stamped on it, and the losing family\'s parent_member_used_count stays 0 against a real account_entitlements row. The CONCURRENT case the owner required -- two families accepting invitations for the same initially-UNBOUND account -- is the row\'s other hostile case below.',
    testFile: 'test/db/parentAccount.mysql.test.mjs',
    testName: 'MySQL SECURITY: an account already bound to ONE family is REFUSED when it tries to accept a second family invitation -- the invitation stays PENDING and that family spends NO seat',
  }],
  ['MySqlInvitationRepository', {
    status: 'CERTIFIED',
    realWriter: 'InvitationService.createInvitation/redeemInvitation/revokeInvitation, holding the real repository (buildService() injects it)',
    realReader: 'InvitationService.redeemInvitation returns the committed record, and repository.findByTokenHash reads the persisted status back',
    hostileCase: 'expired invitation rejects with EXPIRED, revoked rejects with REVOKED, a second redemption rejects with ALREADY_REDEEMED, an out-of-order backward transition is rejected without corrupting the persisted forward state, and 30 simultaneous redemptions of one token leave exactly 1 winner and 29 ALREADY_REDEEMED',
    testFile: 'test/db/invitation.mysql.test.mjs',
    testName: 'MySQL CRITICAL CONCURRENCY: many simultaneous redemption attempts against one invitation -- exactly 1 succeeds',
  }],
  ['MySqlEnrollmentCoordinatorRepository', {
    status: 'CERTIFIED',
    realWriter: 'EnrollmentCoordinator.enroll (buildCoordinator() injects the real repository), driven alongside the real InvitationService that redeems the token',
    realReader: 'the device and its DSK+DEK are read back after commit, and the invitation is re-read through the real repository to confirm it was redeemed in the same transaction',
    hostileCase: 'FAILURE INJECTION: a duplicate public key aborts the WHOLE transaction -- no orphan device row, the invitation stays unredeemed and no attempt row is written; plus same attemptId against a DIFFERENT token is ATTEMPT_CONFLICT leaving no device for the loser, and a cross-family recovery secret never recovers another family attempt',
    testFile: 'test/db/enrollment.mysql.test.mjs',
    testName: 'MySQL FAILURE INJECTION: duplicate public key (DSK or DEK) aborts the WHOLE transaction -- no orphan device, invitation stays unredeemed, no attempt row',
  }],
  ['MySqlDeviceRepository', {
    status: 'CERTIFIED',
    realWriter: 'DeviceDirectoryService.registerDevice/addDeviceKey/revokeDevice, holding the real repository',
    realReader: 'DeviceDirectoryService.listActiveKeys reads the persisted key set back and asserts the exact keyId and keyPurpose',
    hostileCase: 'a duplicate public key is rejected with DUPLICATE_KEY; a wrong-family lookup is indistinguishable from a nonexistent device; destroyed key material is permanently tombstoned for the same device, another device and another family; and createDeviceWithKey leaves no orphan device row when the key insert fails',
    testFile: 'test/db/device.mysql.test.mjs',
    testName: 'MySQL: device + initial key creation persists atomically',
  }],
  ['MySqlRelayRepository', {
    status: 'CERTIFIED',
    realWriter: 'RelayService.queueEnvelope/acknowledgeEnvelope, holding the real repository',
    realReader: 'RelayService.fetchEnvelope reads the envelope back and its ciphertext is compared byte-for-byte with what was queued',
    hostileCase: 'a wrong recipient cannot read the envelope (NOT_FOUND, not a distinguishable refusal), conflicting reuse of a messageId with different ciphertext is CONFLICT, and an envelope past its TTL is EXPIRED',
    testFile: 'test/db/relay.mysql.test.mjs',
    testName: 'MySQL: recipient-scoped retrieval -- wrong recipient cannot read the envelope',
  }],
  ['MySqlReleaseRepository', {
    status: 'CERTIFIED',
    realWriter: 'ReleaseService.publishRelease/rollbackToRelease, holding the real repository',
    realReader: 'ReleaseService.getCurrentRelease reads the persisted pointer back and its version is asserted',
    hostileCase: 'reusing a package/version identity with different artifact data is CONFLICT, and after publishing 9.0.0 then 1.0.0 the pointer still reads 9.0.0 -- an ordinary publish cannot silently move it backward',
    testFile: 'test/db/release.mysql.test.mjs',
    testName: 'MySQL: ordinary publish cannot silently move the current pointer backward',
  }],
  ['MySqlChildProfileRegistryRepository', {
    status: 'CERTIFIED',
    realWriter: 'the real HTTP registry route POST /v1/families/:familyId/children, through ChildProfileService holding the real repository, on the composed buildServer app',
    realReader: 'the childProfileId returned by that route is then accepted by the real invitation route, which reads the persisted membership back to authorise the binding',
    hostileCase: 'a childProfileId that was never created is rejected 400, and one belonging to a DIFFERENT family is rejected with the SAME shape as nonexistent -- no cross-family existence oracle',
    testFile: 'test/db/childProfileInvitationBindingHttp.mysql.test.mjs',
    testName: 'MySQL HTTP (real childProfileMembership wiring): a childProfileId that belongs to a DIFFERENT family is rejected with the SAME shape as nonexistent -- no cross-family existence oracle',
  }],
  ['MySqlFamilyMemberInvitationRepository', {
    status: 'CERTIFIED',
    realWriter: 'FamilyMemberInvitationService.acceptInvitation -> MySqlFamilyMemberInvitationRepository.acceptAtomically',
    realReader: 'MySqlFamilyMemberInvitationRepository.findByIdForFamily, read back after the service returns',
    hostileCase: 'two independent failure paths: a non-addressee with a valid account gets NOT_FOUND and the row stays PENDING (and an ACCEPTED invitation is indistinguishable from one that never existed); and an entitlement-ledger failure during acceptance rolls the whole transaction back, leaving PENDING and charging zero seats',
    testFile: 'test/db/parentAccount.mysql.test.mjs',
    testName: 'accepting a family-member invitation consumes exactly one parent-member seat, in the SAME transaction as the invitation transition',
  }],
  ['MySqlEyeProtectionSettingsRepository', {
    status: 'CERTIFIED',
    realWriter: 'the real eye-protection HTTP route through EyeProtectionSettingsService, holding the real repository',
    realReader: 'repository.get(familyId, childProfileId) is read back directly and the exact persisted remindersEnabled/familyId are asserted',
    hostileCase: 'a VIEWER POSTing through the real route is refused 403 AND the persisted value is still false -- no write occurred; separately a foreign-family child with a real saved setting never leaks it, and a foreign child and a nonexistent one return the identical safe-default shape',
    testFile: 'test/db/eyeProtectionSettingsHttp.mysql.test.mjs',
    testName: 'MySQL HTTP (no regression): a VIEWER still cannot edit the eye-protection setting through the REAL fixed repository -- NOT_AUTHORIZED, no write occurs',
  }],
  ['MySqlEntitlementRepository', {
    status: 'CERTIFIED',
    realWriter: 'PlatformAdminEntitlementService.setEntitlementLimit, which delegates to EntitlementService holding the real repository',
    realReader: 'EntitlementService.getForFamily reads both families back and the persisted managedDeviceLimit is asserted on each',
    hostileCase: 'the test IS the adversarial property: raising family A to 9 must leave family B at 1. Its sibling case asserts a downgrade below active usage flips overLimitManagedDevice and NEVER force-removes occupants.',
    testFile: 'test/db/platformEntitlementsCore.mysql.test.mjs',
    testName: 'cross-family isolation: raising one family entitlement never affects another',
  }],
  ['MySqlChangeRequestRepository', {
    status: 'CERTIFIED',
    realWriter: 'ChangeRequestService.createRequest for the write, then PlatformAdminEntitlementService.approveParentMemberRequest for the approval -- both real services over the real repository',
    realReader: 'EntitlementService.getForFamily reads the resulting limit back and asserts parentMemberLimit === 2',
    hostileCase: 'invalid transitions: approving a DENIED request rejects, and denying an APPROVED request rejects -- both asserted against the real admin service',
    testFile: 'test/db/platformEntitlementsCore.mysql.test.mjs',
    testName: 'parent-member request: never carries a quote, approved directly PENDING -> APPROVED, raises parentMemberLimit',
  }],
  ['MySqlSlotReservationRepository', { status: 'GAP', category: 'NO_PRODUCTION_WRITER', note: 'RE-CATEGORISED from NOT_EXECUTED_IN_CI, which was factually wrong: the file runs in CI. The reserve/release paths ARE driven by a real production caller -- platformEntitlementsSlots.mysql.test.mjs constructs the real SlotReservationService and drives it through the real InvitationService, asserting that a capacity-rejected invitation persists nothing. What is missing is a PRODUCTION CALLER for one transition: the test itself is named "slot consumption hook: RESERVED -> CONSUMED moves reserved count to active count (defined, though not wired to any caller in this codebase -- see PCA-PA-2 final report)". So the store is half-wired, and certifying it would imply the whole API is reachable in production. Tracked as PCA-DEC-031.' }],
  ['MySqlComplimentaryGrantRepository', {
    status: 'CERTIFIED',
    realWriter: 'the real HTTP route POST /platform-admin/families/:familyId/complimentary-grants, through PlatformAdminComplimentaryGrantService and ComplimentaryEntitlementService into the real repository',
    realReader: 'the GET list route reads the grant back and asserts exactly one item carrying the persisted amount',
    hostileCase: 'a FINANCE_ADMIN POSTing a well-formed body through the same route is refused server-side, so the RBAC is enforced in the service and not merely hidden in the admin UI; step-up is required alongside it',
    testFile: 'test/db/complimentaryGrants.mysql.test.mjs',
    testName: 'HTTP: create -> list -> revoke round trip, and RBAC/step-up enforced at the route layer',
  }],
  ['MySqlFreeAccessAccountRepository', {
    status: 'CERTIFIED',
    realWriter: 'FreeAccessAdminService.adjustAccount, holding the real repository',
    realReader: 'the row is re-read with repository.findByAccountId and the exact persisted mode/expiresAt are asserted, alongside the paired SETTING_CHANGED audit row counted from the database',
    hostileCase: 'adjustAccount without a valid step-up is rejected server-side even for an APP_OWNER and mutates nothing (the persisted snapshot is compared before and after), and a FINANCE_ADMIN is refused the same operation',
    testFile: 'test/db/freeAccessEnforcement.mysql.test.mjs',
    testName: 'MySQL: existing-account adjustment persists AND writes a paired SETTING_CHANGED audit event in the same transaction (reused event_type, no migration needed)',
  }],
  ['MySqlSettlementRepository', {
    status: 'CERTIFIED',
    realWriter: 'PlatformAdminSettlementService.openBatch, which reaches the real repository through the settlement service and the real route module',
    realReader: 'PlatformAdminSettlementService.getBatch reads the batch back and asserts the exact bigint net amount survives the BIGINT column, plus the SETTLEMENT_BATCH_CREATED audit count',
    hostileCase: 'a batch currency that does not match its settlement account is rejected; an UNDER_INVESTIGATION batch is never reported RESOLVED and cannot be double-counted as closed; and concurrent resolution attempts on one batch leave exactly one winner',
    testFile: 'test/db/settlement.mysql.test.mjs',
    testName: 'same-currency batch: net/received/difference round-trip through real BIGINT columns exactly, MATCHED when difference is zero',
  }],
  ['MySqlEmailOutboxRepository', {
    status: 'CERTIFIED',
    realWriter: 'createFirstOwnerBootstrap, whose real EmailService holds the real outbox repository; the test asserts the durable outcome is INSERTED before anything else',
    realReader: 'attemptDeliveryAndRecordOutcome with the real repository claims the persisted row back (RETRY_SCHEDULED against a genuinely rejecting provider), and raw SELECTs confirm the surrounding account/role rows',
    hostileCase: 'two independent failure paths: a real RejectingEmailProviderAdapter leaves the bootstrapped owner ACTIVE and the row retryable rather than losing it, and a forced real ER_DUP_ENTRY on the outbox INSERT rejects the whole bootstrap -- the test reads email_outbox back and asserts OUTBOX_DELTA = 0',
    testFile: 'test/db/platformAdminBootstrap.mysql.test.mjs',
    testName: 'POST_COMMIT_PROVIDER_FAILURE_RECOVERABLE: provider delivery failure AFTER a successful atomic commit never invalidates the bootstrapped owner',
  }],
  ['MySqlFamilyAuthorityGenesisStore', { status: 'GAP', category: 'CRYPTO_GATED', note: 'RE-CATEGORISED from NOT_EXECUTED_IN_CI. VERIFIED IN SOURCE: main.ts passes new RejectingDeviceSignatureVerifier() into FamilyOwnerAttestationChainEngine (the genesis store is its first argument), so in PRODUCTION this store is never written -- the engine refuses first, pending the CRYPTO_SUITE human security review (PCA-DEC-020 family). familyCommercialAuthority.mysql.test.mjs and protectionAlerts.mysql.test.mjs exercise it with createTestOnlyDeviceSignatureVerifier() instead. Certifying on a test-only verifier would certify a production path that does not exist, which is precisely the substitution this rule forbids. Stays honestly gated until PCA-DEC-020-R2.' }],
  ['MySqlFamilyAuthorityAttestationChainStore', { status: 'GAP', category: 'CRYPTO_GATED', note: 'RE-CATEGORISED from NOT_EXECUTED_IN_CI, same evidence and same reason as MySqlFamilyAuthorityGenesisStore: production wires RejectingDeviceSignatureVerifier into the same engine, so nothing appends through it today, and the DB suites use a TEST-ONLY verifier. Do NOT certify it with a test-only verifier, and do NOT add a test-only bypass to move the number.' }],
  ['MySqlDeviceChallengeRepository', { status: 'GAP', category: 'CRYPTO_GATED', note: 'the production device-signature verifier rejects unconditionally pending PCA-DEC-020.' }],
  ['MySqlEnvelopeAcceptanceTransaction', { status: 'GAP', category: 'CRYPTO_GATED', note: 'RejectingEnvelopeSignatureVerifier + rejecting context resolver make no production write reachable.' }],
  ['MySqlMessageIdempotencyLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'reached only through envelope acceptance, which the rejecting verifier blocks.' }],
  ['MySqlReplayLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'same: no production envelope is accepted, so nothing is recorded.' }],
  ['MySqlDataVersionLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'reached only through the same envelope-acceptance path, which the rejecting signature verifier blocks.' }],
  ['MySqlSequenceProgressLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'reached only through the same envelope-acceptance path; no production envelope is accepted, so no sequence is recorded.' }],
  ['MySqlFamilyAuditEventLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'the crypto-bound composer throws first, so delivery records nothing.' }],
  ['MySqlProtectionAlertLedger', { status: 'GAP', category: 'CRYPTO_GATED', note: 'same rejecting composer shape as the audit ledger.' }],
  ['MySqlCommercialNotificationPublisher', {
    status: 'CERTIFIED',
    realWriter: 'MySqlCommercialMaintenanceRunner.runOnce publishing through the real MySqlCommercialNotificationPublisher into a real CommercialNotificationRepository (buildRunner injects both)',
    realReader: 'countNotificationRows(QUOTE_EXPIRED:<quoteId>) and readNotificationRow read the persisted commercial_notifications rows back and assert exact counts',
    hostileCase: 'the crash-gap case: a quote transitioned to EXPIRED but never notified (exactly the state a crash between transition and publish leaves) must be published EXACTLY ONCE by the next runOnce, and a third runOnce must publish nothing; plus concurrent retention-prune passes never double-delete',
    testFile: 'test/db/commercialMaintenance.mysql.test.mjs',
    testName: 'MySQL RESTART SAFETY: a quote transitioned to EXPIRED but never notified (simulated crash between transition and publish) is picked up -- exactly once -- by the NEXT runOnce(), never duplicated',
  }],
  ['MySqlCommercialMaintenanceRunner', {
    status: 'CERTIFIED',
    realWriter: 'the runner itself, constructed with real quote/change-request/notification repositories -- four independent instances, as separate processes would be',
    realReader: 'readQuoteStatus and countNotificationRows read both the quote transition and the notification row back from MySQL',
    hostileCase: 'THREE layers. Concurrency: four instances racing runOnce() against the same due quotes produce exactly one QUOTE_EXPIRED notification per quote, no duplicates. Liveness (PCA-COMMERCIAL-LIVENESS-1): with a batch-full of permanently unattributable expired quotes sitting AHEAD of an eligible one in the (expires_at ASC) scan order, the eligible quote is still reached and notified exactly once, and the drain ends by exhausting the scan -- bounded by counting the skip-warnings the runner emits per skipped row, since reaching MAX_PASSES_PER_RUN would require at least 1000x batchSize of them. Before that fix the scenario measured 1,000 passes, 3,000 skip-warnings and ZERO notifications for the eligible quote. Attribution durability (PCA-COMMERCIAL-LIVENESS-2): a no-reference quote becomes TERMINAL_UNATTRIBUTABLE exactly once and is never re-scanned, an unresolved-reference quote stays PENDING_ATTRIBUTION under a durable backoff and is NOT retried before next_attempt_at, a not-yet-due backlog cannot starve a newly eligible quote, a process restart honours the persisted schedule, concurrent runners do not duplicate the terminal transition, and a quote that becomes attributable later IS notified exactly once (with its retry state cleared). A build-time guard proves the permanence claim rather than assuming it: test/tooling/commercialAttributionPermanence.test.mjs fails if any statement anywhere reassigns billing_quotes.increase_request_ref, or if terminality starts depending on age or retry count.',
    testFile: 'test/db/commercialMaintenance.mysql.test.mjs',
    testName: 'MySQL LIVENESS: unattributable expired quotes filling the batch must not starve an eligible quote behind them, and the drain must end by exhaustion, not by the pass cap',
  }],
  ['MySqlPlatformAdminAuthRepository', {
    status: 'CERTIFIED',
    realWriter: 'PlatformAdminAuthService.login / PlatformAdminAccountService, both holding the real repository (the suite constructs the real pair over it)',
    realReader: 'session validation and the durable lockout state are read back through the service; the audit read path is queried back too',
    hostileCase: 'lockout: after 5 failed attempts inside the window a 6th attempt with the CORRECT password and TOTP is still rejected -- the failure counter is durably read, not held in memory; plus the raw session token is never stored, only its hash, and a duplicate ACTIVE role grant is rejected by the DB unique constraint',
    testFile: 'test/db/platformadmin.mysql.test.mjs',
    testName: 'MySQL: lockout after 5 failed attempts within the window rejects a 6th attempt even with the correct password+code',
  }],
  ['MySqlPlatformAdminActivationRepository', {
    status: 'CERTIFIED',
    realWriter: 'createFirstOwnerBootstrap and the real PlatformAdminActivationService issuing and consuming the token inside the atomic bootstrap',
    realReader: 'the full real lifecycle -- bootstrap, then login/whoami/logout -- reads the activation back through the service, and a separate case asserts the PERSISTED token_hash equals hashActivationToken(rawToken) and does not contain the raw token',
    hostileCase: 'a forced real duplicate on the activation-token INSERT rejects the whole bootstrap, and the test reads the token table back asserting ACTIVATION_DELTA = 0; separately ACTIVATION_REISSUE invalidates the old token and the old pending TOTP',
    testFile: 'test/db/platformAdminBootstrap.mysql.test.mjs',
    testName: 'FIRST_OWNER_END_TO_END_ACTIVATION: full real lifecycle through the atomic bootstrap, then login/whoami/logout',
  }],
  ['MySqlPlatformAdminAlertAdapter', {
    status: 'CERTIFIED',
    // Was NOT_EXECUTED_IN_CI with the note "coverage in platformAdminAlerts.mysql.test.mjs" --
    // which was true and insufficient: both of that file's original tests construct
    // the adapter themselves and call notifyAppOwners directly, so they prove the
    // adapter WRITES and say nothing about whether production ever calls it. Exactly the
    // STORE_TEST_PASS != PRODUCTION_PATH_PASS shape.
    realWriter: 'PlatformAdminAuthService.login -> recordFailureAndMaybeAlert -> the injected PlatformAdminAlertPort, which is MySqlPlatformAdminAlertAdapter; the test constructs the REAL MySqlPlatformAdminAuthRepository and the REAL adapter, so nothing between the service and the row is a double',
    realReader: 'the durable row is read back from platform_admin_security_alerts by (source_admin_id, kind, delivery_state, delivered_at), and the login attempt is read back from platform_admin_login_attempts to prove the alert is an addition to the audit trail rather than a substitute for it',
    hostileCase: 'A genuine failed login for an ACTIVE APP_OWNER account -- a REAL scrypt credential for a password the test does not supply, so the failure is a real credential mismatch rather than a malformed-credential short circuit. Asserts the OTHER active APP_OWNER is notified, that the source owner is NOT notified of its own failure, that kind is LOGIN_FAILED (not LOCKED_OUT), and that delivery_state is PENDING with delivered_at NULL so no external delivery is fabricated. Falsifying by construction: no other writer of that table runs in this test, so the row cannot exist unless the real adapter was reached through the real service -- a swapped-in LoggingAlertAdapter or an unwired port fails it.',
    testFile: 'test/db/platformAdminAlerts.mysql.test.mjs',
    testName: 'MySQL REAL-WRITER: a failed login through the REAL PlatformAdminAuthService reaches the real alert adapter and durably notifies the other APP_OWNER',
  }],
  ['MySqlOwnerParentDeviceResolver', { status: 'GAP', category: 'CRYPTO_GATED', note: 'RE-CATEGORISED from NOT_EXECUTED_IN_CI, because that category named the wrong obstruction and implied the fix was more test coverage. VERIFIED IN SOURCE: main.ts constructs `new ProtectionAlertProducer(protectionAlertLedger, createRejectingOpaqueProtectionAlertComposer())` and passes this resolver as `protectionAlerting.resolveParentDevices`, so the resolver IS reached in production via RemovalDecisionAuthority.emitAlert -- but ProtectionAlertProducer.produce awaits that composer, which throws unconditionally. RejectingOpaqueProtectionAlertComposer\'s own doc comment states PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW (PCA-DEC-020), that "no alert is ever recorded in production today", and explicitly forbids substituting a composer that returns fabricated ciphertext or any other shortcut. So this is the SAME obstruction as MySqlProtectionAlertLedger\'s row ("rejecting composer shape"), and the fix is a reviewed concrete composer -- NOT more tests. Writing the real-consumer test that closed MySqlPlatformAdminAlertAdapter is therefore not available here: that row\'s real writer produced a durable row, whereas this one\'s real writer is deliberately stopped before any write. NOT untested: three real-MySQL tests drive the resolver directly in protectionAlerts.mysql.test.mjs (genesis Owner resolved as sole recipient; an Owner transfer resolves the NEW owner never the outgoing one; zero recipients for a family with no attestation, never fabricated). Those prove the resolver\'s own logic and run in CI via npm run test:db; what no test can prove is a durable production write that the production wiring prevents by design. Separately recorded honest scope, not part of this re-categorisation: the resolver returns the Owner device ONLY (never ADMINISTRATOR-role devices), because no table in this codebase registers per-device keys for non-Owner parent roles -- documented at length in the resolver\'s own header and tracked as PCA-DEC-031.' }],
  ['MySqlFamilyMembershipRepository', { status: 'CERTIFIED', realWriter: 'MySqlFamilyMemberAccountBinder.tryBindAccountToFamilyOnConnection -> MySqlFamilyMembershipRepository.applyAcceptedInvitationRoleOnConnection, invoked on the ACCEPTANCE transaction\'s own connection; the test drives the real FamilyMemberInvitationService create+accept path, so membership is written by the same atomic transaction that flips the invitation and charges the seat', realReader: 'ParentAccountService.readSession (the HTTP-facing GET /api/parent/session) -> resolveFamilyRole -> findActiveRole, down the PRODUCTION fallback chain at ParentAccountService.ts:109 (MySqlParentAccountRepository.findActiveRole -> this repository); the durable role is read back from family_parent_memberships', hostileCase: 'The REVOKED half of the reader contract: after the real accept writes an ACTIVE VIEWER membership, the row is marked REVOKED and the real consumer must fail closed to null -- a durable row is not authority merely because it exists, so a removed member cannot keep an elevated session. The writer side carries its own hostile cases in the MySqlFamilyMemberAccountBinder row: an account already bound to ONE family accepting a second, genuinely-addressed invitation is refused with FAMILY_CONFLICT and gains NO membership row in the losing family, and no seat is charged.', testFile: 'test/db/parentAccount.mysql.test.mjs', testName: 'MySQL REAL WRITER->CONSUMER: accepted family membership is returned by ParentAccountService, while a revoked row fails closed', note: 'PROMOTED 2026-09-22 (25 -> 26 certified, BASELINE_GAP_COUNT 25 -> 24), on the owner\'s condition that the class be re-evaluated rather than auto-promoted once its dead methods disappeared. Its COMPLETE remaining production surface is exactly two methods and both satisfy PCA-DEC-033 in full: applyAcceptedInvitationRoleOnConnection has a real writer (the invitation path, proven end to end through the real service and binder) and findActiveRole has a real consumer (ParentAccountService.readSession, proven through the real HTTP-facing entry point); the negative path is the REVOKED-row fail-closed assertion; the file is executed by CI and is in CERTIFIED_FILES; and the file passes 19/19 with 0 skipped against the POPULATED database as-is. The two methods that blocked this row (createGenesisAdministrator, applyAcceptedInvitationRole) were DELETED under owner ruling FAMILY_MEMBERSHIP_REPOSITORY_OWNER_DECISION = DELETE_DEAD_WRAPPERS, which also removed MySqlParentAccountRepository\'s three compatibility forwarding wrappers and stopped that class claiming to implement this port. NOT resolved by the deletion, and deliberately left alone: genesis still writes family_parent_memberships through MySqlGenesisTransactionRepository\'s own in-transaction INSERT, so the table still has two writers; the owner ruled that consolidating them must be done via a connection-scoped genesis helper, NOT by repointing genesis at the deleted wrapper (which opened its own transaction and would have split one atomic genesis operation in two). HISTORICAL EVIDENCE, retained verbatim below this line because it is what the promotion rests on: INVESTIGATED METHOD BY METHOD -- the four methods are NOT in one state. (a) applyAcceptedInvitationRoleOnConnection has a real production writer: MySqlFamilyMemberAccountBinder.tryBindAccountToFamilyOnConnection calls it on the acceptance transaction\'s own connection (MySqlFamilyMemberAccountBinder.ts:88). parentAccount.mysql.test.mjs drives that exact invitation-service -> binder path and asserts the durable family_parent_memberships row, including hostile cross-family and concurrent-winner cases. (b) findActiveRole is production-reachable through ParentAccountService.resolveFamilyRole (ParentAccountService.ts:545), with main.ts injecting the explicit durable repository. It is now proven through its REAL consumer by `MySQL REAL WRITER->CONSUMER: accepted family membership is returned by ParentAccountService, while a revoked row fails closed`: the real invitation path writes an ACTIVE VIEWER membership, ParentAccountService.readSession returns VIEWER, then the same durable row is marked REVOKED and the consumer returns null while retaining the account\'s family identity. No direct repository call substitutes for either side. (c) createGenesisAdministrator and (d) applyAcceptedInvitationRole still have NO PRODUCTION CALLER, which is what keeps this CLASS row open under NO_PRODUCTION_WRITER: their only src references are the interface, implementation, and MySqlParentAccountRepository forwarding wrappers; nothing calls either wrapper. The real genesis membership write is instead MySqlGenesisTransactionRepository.ts:110, with its own INSERT into family_parent_memberships, so createGenesisAdministrator is an uncalled SECOND writer of the same table. CERTIFICATION STATUS: both production-reachable methods are now empirically covered, but the class was NOT promoted AT THAT TIME, and BASELINE_GAP_COUNT was not lowered then until the owner chooses whether to delete the two uncalled methods or repoint the genesis path at the repository so the duplicate writer is removed. A test cannot make an uncalled writer a production path.' }],
]);

/** The gap count may only go DOWN. See the ratchet test. */
const BASELINE_GAP_COUNT = 24;

const GAP_CATEGORIES = new Set([
  'NO_PRODUCTION_WRITER',
  'SYNTHETIC_ONLY',
  'NOT_EXECUTED_IN_CI',
  'CRYPTO_GATED',
  // Added when the empirical gate first ran over an expanded certified scope.
  // The four original categories all describe MISSING COVERAGE (no writer, only
  // doubles, never executed, honestly crypto-gated). This one describes a
  // different blocker that the other four cannot express without lying: the
  // real writer/dependency/reader path IS verified, but the file FAILS the
  // populated-state gate, so the row is blocked by a TEST defect rather than by
  // absent evidence. Without it such a row had to be filed under a category that
  // was factually false, which is the failure mode this whole register exists to
  // eliminate.
  'POPULATED_STATE_FAILURE',
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
