// P1-04 (PCA full assessment). The production composition root
// (backend/src/main.ts) constructs in-memory implementations of several
// repositories. Some are acceptable today; some are tracked debt that must
// become durable; one is waiting on an architecture/privacy determination.
//
// The problem this test solves is not "these exist" -- it is that a NEW one
// could be added silently, and that the existing ones had never been forced
// through an explicit decision. A reviewer reading main.ts cannot tell an
// accepted in-memory choice from an oversight, and neither can a future
// session. So the classification is encoded here as an enforced allowlist:
// any in-memory store constructed in the production root must appear below
// with a reason, and any entry below that no longer exists must be removed.
//
// DB-free, so it runs in the plain `npm test` pipeline.
//
// GRADUATED OUT (P1-04, Wave 1): `InMemoryActionIdempotencyLedger` used to be the
// durableRequired entry here. The production root now constructs
// `MySqlActionIdempotencyLedger` (migration 0047), so that class is no longer a
// production in-memory store and its row was removed. The test below fails if a
// register row outlives the construction it describes, which is why this note
// exists rather than a silently deleted row. The in-memory class itself remains,
// as the reference implementation the DB-free suites use.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const MAIN_PATH = fileURLToPath(new URL('../../src/main.ts', import.meta.url));

/**
 * Every in-memory implementation the PRODUCTION composition root may construct,
 * each with the classification P1-04 requires. `durableRequired` marks the ones
 * that are NOT acceptable as permanent production state -- they are listed so
 * they cannot be forgotten, not because they are approved.
 *
 * Do not add an entry here to make a new in-memory dependency pass. Classify it
 * first: if it holds security-, audit- or idempotency-relevant state that is
 * lost on restart, it belongs in the "durableRequired" set and needs a
 * MySQL-backed repository and a migration, not an allowlist row.
 */
const PRODUCTION_IN_MEMORY_STORES = new Map([
  [
    'InMemoryFamilyAuditRepository',
    {
      durableRequired: false,
      classification:
        'DETERMINED -- NO DURABLE SERVER-SIDE COUNTERPART IS PERMITTED, so this is not debt. The ' +
        'determination the previous entry deferred has since been made by reading the governing ' +
        'document rather than inferring from the code comment. Doc 18 states the rule about audit ' +
        'records AS A CLASS, not about a "content" subset of event categories: PCA-FR-092 "never a ' +
        'readable PCA-server copy"; Section 4 "the family audit event is encrypted to authorized ' +
        'devices"; Section 5 "they are not PCA server audit logs and do not carry activity ' +
        'plaintext" and free text is "E2EE only, and excluded from push/email/logging"; Section 6 ' +
        'asserts no URLs/locations/activity detail/plaintext in infrastructure logs. ' +
        'docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md left this as an ' +
        'open NEW_OWNER_DECISION_REQUIRED sub-question only because it lacked doc 18\'s full text, ' +
        'and instructed that the safe reading stand unless a human reviewed Section 5/6 and said ' +
        'otherwise. That review is done and it does NOT relax the rule. So a readable server-side ' +
        'table for FamilyAuditRecord (including its freeTextNote) is forbidden, and the server-side ' +
        'representation is the OPAQUE one that already exists and is already wired: ' +
        'FamilyAuditEventProducer composes a crypto-bound envelope, MySqlFamilyAuditEventLedger ' +
        'holds only ciphertext under a server-ciphertext TTL, and decryption happens in the trusted ' +
        'parent browser. GET /api/parent/families/:familyId/audit-events returns opaque fields only, ' +
        'so no plaintext read endpoint exists either. Restart loss of THIS in-process copy therefore ' +
        'loses nothing that is supposed to be durable server-side. Residual gap, stated rather than ' +
        'smoothed over: the delivery composer is createRejectingOpaqueFamilyAuditEventComposer, the ' +
        'same CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW gate as every other E2EE surface, so ' +
        'until that review lands an event is generated and then discarded fail-closed -- a recorded ' +
        'owner-gated dependency (PCA-DEC-020), not a source-actionable defect, because the ' +
        'alternative is exactly the readable store doc 18 forbids. Note for future sessions: ' +
        'server-generated STEP_UP_SUCCESS/STEP_UP_FAILURE/DENIED_AUTHORIZATION_ATTEMPT records are ' +
        'still FAMILY AUDIT RECORDS (doc 18 Section 5 lists them as required examples). Being ' +
        'server-GENERATED does not entitle the server to a readable COPY of them, and they must not ' +
        'be moved into a "server-appropriate" plaintext store on that reasoning.',
    },
  ],
  [
    'InMemoryPendingQueueStore',
    {
      durableRequired: false,
      classification:
        'ACCEPTED. Liveness-only working queue: durability of sequence progress is provided separately by ' +
        'MySqlSequenceProgressLedger, and restart simply re-runs acceptance through the full envelope ' +
        'pipeline. Losing the queue costs a retry, not correctness.',
    },
  ],
  [
    'InMemoryChildRequestRepository',
    {
      durableRequired: true,
      classification:
        'TRACKED DEBT, NOT ACCEPTED -- but the remedy this row used to state was WRONG and would have ' +
        'built the store the module forbids. It said "Requires a MySQL-backed repository plus a ' +
        'migration"; ChildRequest carries real family content (reasonNote free text, requestedAppScope, ' +
        'installTargetPackageName, installTargetAppLabel), so a plaintext table for it is exactly what ' +
        'ChildRequestRepository.ts\'s own contract calls "never a central readable store of child ' +
        'request content". The debt is genuine and stays tracked: restart loss makes a parent\'s request ' +
        'list silently EMPTY, which reads as "no requests" rather than as unavailable. What is ' +
        'undecided is the SHAPE of the fix, not whether one is needed -- an opaque crypto-bound ' +
        'envelope with the authoritative record on family devices (the shape familyrbac/audit-events ' +
        'already uses) versus accepting plaintext to an authenticated parent session. That is ' +
        'PCA-DEC-028, an owner/architecture decision, deliberately not taken unilaterally. Binding ' +
        'either way: do NOT satisfy this row with a plaintext table.',
    },
  ],
  [
    'InMemoryDeviceSessionRepository',
    {
      durableRequired: false,
      classification:
        'ACCEPTED TODAY, CONDITIONALLY. No device session can be minted at all while main.ts wires ' +
        'RejectingDeviceSignatureVerifier (unconditional fail-closed pending the human crypto review), so ' +
        'there is nothing durable to lose. This classification MUST be revisited at the same time device ' +
        'proof is activated -- it does not survive that change.',
    },
  ],
  [
    'InMemoryBlockDecisionStateRepository',
    {
      durableRequired: true,
      classification:
        'TRACKED DEBT, NOT ACCEPTED -- the failure mode was the worst of the set, and the WORST HALF OF ' +
        'IT IS NOW FIXED. It feeds a parent dashboard card, so restart loss did not merely lose data: ' +
        'the card rendered it as capabilityState AVAILABLE plus "No recent site blocks", which a ' +
        'parent reads as a fact about their child. That was worse in production than the restart case ' +
        'suggests, because nothing in the process ever writes to this store (the Safe-Browser ' +
        'recording surface is not wired to a route), so the card asserted "no blocks" to every family ' +
        'unconditionally, from an empty map, and dashboard/types.ts forbids exactly that ("a card must ' +
        'never report AVAILABLE merely because its UI exists"). WebFilteringDashboardCardProvider now ' +
        'takes a REQUIRED BlockHistoryCompleteness and main.ts passes INCOMPLETE_EPHEMERAL, so the ' +
        'card reports UNAVAILABLE with "Site block history unavailable" and surfaces no count -- which ' +
        'is the resolution this row already prescribed (make it durable, or make the card report ' +
        'itself unavailable) and the only one reachable without inventing policy. What REMAINS is the ' +
        'durable half, and it must NOT be discharged as a plaintext table: BlockDecisionState carries ' +
        'the full url/pageTitle, and the store documents itself as device-local by contract ("no MySQL ' +
        'repository is provided, since this module must never centralize readable browsing history ' +
        'server-side") -- so a plaintext table here would be the single worst privacy outcome in the ' +
        'codebase, not a fix. The E2EE-consistent shape is the opaque-envelope pattern already built ' +
        'for audit events and alerts, which is gated by the same crypto review as every other E2EE ' +
        'surface.',
    },
  ],
  [
    'InMemoryModeBFeatureFlagRepository',
    {
      durableRequired: false,
      classification:
        'ACCEPTED. YouTube Mode B is a feature flag whose default is disabled and whose activation is ' +
        'separately owner-reviewed (YOUTUBE_MODE_B_POLICY_REVIEW). Restart reinstates the SAFE state, so ' +
        'restart loss errs toward the safer configuration.',
    },
  ],
  [
    'BonusGrantLedger',
    {
      durableRequired: false,
      classification:
        'DOCUMENTED-DELIBERATE, NOT SILENT, and now separately determined from the store it used to ' +
        'share a rationale with. Deliberately in-memory per its own class doc comment: bonus-grant ' +
        'content (which app, how many minutes, for how long) is family-policy content, so this is a ' +
        'same-posture bookkeeping store rather than a plaintext family-policy shortcut. The ' +
        'determination the previous wording demanded ("must confirm BOTH rather than one") is ' +
        'COMPLETE, and the two answers DIFFER: the enforcement source of truth is always the ' +
        'device\'s own persisted SchedulePolicyV1, so losing this ledger cannot grant time that was ' +
        'never granted or silently weaken enforcement -- it loses only the server\'s ability to reason ' +
        'about overlap until the next grant, so durability is NOT required here. Contrast ' +
        'InMemoryChildRequestRepository, where the loss is user-visible as a confident-looking empty ' +
        'state and durability IS required. Note the E2EE claim in this class\'s comment is a TARGET ' +
        'rather than a description of the running system (the content is process-local plaintext and ' +
        'the parent-web DTO serves it in the clear) -- see PCA-DEC-028; it is listed here because it ' +
        'is constructed in main.ts and, being named without an "InMemory" prefix, was invisible to ' +
        'the naming-convention detector until an independent review caught it.',
    },
  ],
]);

/**
 * In-memory production stores whose class names do NOT start with "InMemory", and
 * which the pattern below therefore cannot see. Listed explicitly so the blind
 * spot is documented rather than hidden -- the detector recognises a NAMING
 * CONVENTION, not in-memory behaviour, and BonusGrantLedger proved that gap was
 * real (it sat beside a registered store in main.ts, unclassified).
 */
const NON_PREFIXED_IN_MEMORY_STORES = ['BonusGrantLedger'];

const CONSTRUCT_PATTERN = /new\s+(InMemory[A-Za-z0-9_]*)\s*\(/g;

/** Pure text analysis so the detector can be proven non-vacuous against a synthetic source. */
function inMemoryStoresConstructedIn(source) {
  const found = new Set([...source.matchAll(CONSTRUCT_PATTERN)].map((match) => match[1]));
  for (const name of NON_PREFIXED_IN_MEMORY_STORES) {
    if (new RegExp(`new\\s+${name}\\s*\\(`).test(source)) found.add(name);
  }
  return found;
}

test('NEGATIVE CONTROL: the detector really does find in-memory constructions, including non-prefixed names', () => {
  const synthetic = [
    'const a = new InMemoryThing();',
    'const b = new InMemoryAnotherRepository(dep);',
    'const c = new MySqlThing();',
    'const d = new BonusGrantLedger();',
  ].join('\n');
  assert.deepEqual(
    [...inMemoryStoresConstructedIn(synthetic)].sort(),
    ['BonusGrantLedger', 'InMemoryAnotherRepository', 'InMemoryThing'],
    'the detector must match in-memory constructions (prefixed AND explicitly listed) and ignore durable ones',
  );
  assert.equal(inMemoryStoresConstructedIn('new MySqlThing();').size, 0);
});

test('P1-04: every in-memory store in the production composition root carries an explicit classification', () => {
  const actual = inMemoryStoresConstructedIn(readFileSync(MAIN_PATH, 'utf8'));
  const declared = new Set(PRODUCTION_IN_MEMORY_STORES.keys());

  assert.deepEqual(
    [...actual].sort(),
    [...declared].sort(),
    'main.ts constructs in-memory stores that this register does not classify, or the register lists stores\n' +
      'main.ts no longer constructs. Classify each new one deliberately (and prefer a durable repository for\n' +
      'anything holding security-, audit- or idempotency-relevant state) -- do NOT add a row just to make\n' +
      'this test pass.',
  );
});

test('P1-04: every classification states a real reason, and the durable-required set is not empty', () => {
  for (const [store, entry] of PRODUCTION_IN_MEMORY_STORES) {
    assert.equal(typeof entry.classification, 'string', `${store} must carry a classification string`);
    assert.ok(
      entry.classification.length > 60,
      `${store}'s classification is too short to be a real determination -- state why restart loss is or is not acceptable`,
    );
    assert.equal(typeof entry.durableRequired, 'boolean', `${store} must state whether durability is required`);
  }

  const durableRequired = [...PRODUCTION_IN_MEMORY_STORES.entries()]
    .filter(([, entry]) => entry.durableRequired)
    .map(([store]) => store)
    .sort();
  assert.deepEqual(
    durableRequired,
    ['InMemoryBlockDecisionStateRepository', 'InMemoryChildRequestRepository'],
    'the tracked-durable-debt set changed. If a store was made durable, remove its row from main.ts and from\n' +
      'this register together; if a NEW store is listed as durable-required, that is a new P1-04 item.',
  );
});
