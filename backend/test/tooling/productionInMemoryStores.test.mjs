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
        'NOT YET DETERMINED -- deliberately so. FamilyAuditStore.ts:36-37 documents this repository as ' +
        '"append-only, family-local/E2EE store -- never a PCA server audit log", with real persistence ' +
        'scoped to family-device-local storage. FamilyAuditRecord also carries freeTextNote. Making it a ' +
        'readable server-side table without an explicit architecture/privacy decision risks creating the ' +
        'central readable family-activity store PCA-SEC-023 forbids, and would have to satisfy the ' +
        'machine-enforced privacy gate in test/schema-privacy.test.mjs. Determination required BEFORE ' +
        'any persistence change here.',
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
        'TRACKED DEBT, NOT ACCEPTED. Child requests and the associated bonus-time grants evaporate on ' +
        'restart. Requires a MySQL-backed repository plus a migration.',
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
        'TRACKED DEBT, NOT ACCEPTED (and the worst failure mode of the set). It feeds a parent dashboard ' +
        'card, so losing it on restart does not merely lose data -- it renders as a genuine-looking "no ' +
        'blocks recorded", which a parent would read as a fact about their child. Either make it durable ' +
        'or make the card explicitly report itself as unavailable.',
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
        'DOCUMENTED-DELIBERATE, NOT SILENT. Deliberately in-memory per its own class doc comment ' +
        '(childrequests/BonusGrantLedger.ts:4-16): bonus grants are exactly the E2EE-only family-policy ' +
        'content contracts/schedule-runtime/SchedulePolicyV1.md protects, so this is a same-posture ' +
        'bookkeeping store rather than a central plaintext family-policy shortcut, and the ACTUAL ' +
        'enforcement source of truth is always the device\'s own persisted SchedulePolicyV1 -- losing this ' +
        'ledger does not silently weaken enforcement. It is listed here because it is constructed in ' +
        'main.ts:660 and, being named without an "InMemory" prefix, was invisible to the naming-convention ' +
        'detector until an independent review caught it. It and InMemoryChildRequestRepository share this ' +
        'rationale, so the P1-04 architecture/privacy determination must confirm BOTH rather than one.',
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
