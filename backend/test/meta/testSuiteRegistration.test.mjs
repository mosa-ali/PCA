// PPR-2 (W6): a mechanical gate against ORPHANED backend test files.
//
// THE HOLE THIS CLOSES
// --------------------
// `backend/scripts/run-tests.mjs` carries an explicit, hand-maintained list of
// the non-DB test files that `npm test` executes. A test file that exists on
// disk but is missing from that list NEVER RUNS -- and nothing reports it. The
// author sees a green suite and reasonably concludes their test passed, when in
// fact it was never executed. This is the worst failure mode a test suite can
// have, because it is indistinguishable from success.
//
// It has already happened at least twice in this repository: one prior commit
// wired 16 legitimate, previously-orphaned test files back in, and the PPR-2
// review found `test/invitation/iosEnrollmentUnavailable.test.mjs` orphaned
// again immediately afterwards. Both were caught by a human reading the list.
// That is not a gate.
//
// WHY A PARITY TEST RATHER THAN AUTOMATIC DISCOVERY
// -------------------------------------------------
// The alternative was to delete the manual list and have run-tests.mjs glob the
// tree itself. That was rejected deliberately:
//
//   1. Discovery is not free of exclusions. `test/schema-privacy.test.mjs` and
//      `test/server.test.mjs` are non-DB `*.test.mjs` files that are run as
//      separate direct-execution steps by package.json's `test` script BEFORE
//      run-tests.mjs, and are omitted from the list on purpose. A glob would
//      have to hardcode those two back out -- trading a visible, reviewable list
//      of inclusions for an invisible list of exclusions. The hole moves; it
//      does not close.
//   2. Discovery changes WHAT RUNS as a side effect of adding a file anywhere
//      under test/. Any scratch, in-progress, or environment-dependent
//      `*.test.mjs` would silently join the gating suite. The explicit list is
//      also the review surface.
//   3. A discovery bug (symlink following, a stray copy under a build output
//      directory, a readdir permission error swallowed) degrades toward running
//      FEWER tests silently -- the exact failure mode being fixed.
//
// This test instead leaves run-tests.mjs's runtime behaviour byte-for-byte
// unchanged and makes the omission itself impossible to land: the list is still
// hand-maintained, but a file that is not on it fails the build. The failure
// direction of this test is also safe -- if its own parse of run-tests.mjs ever
// breaks, it reports every file as unregistered and goes RED, never green.
//
// The "run directly by package.json" exemption is derived MECHANICALLY from
// package.json's own `test` script string rather than hardcoded here, so
// deleting `node test/server.test.mjs` from that script re-arms this gate for
// that file automatically.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUNNER_RELATIVE_PATH = 'scripts/run-tests.mjs';

/** Every `*.test.mjs` under backend/test, as posix paths relative to backend/. */
function listTestFilesOnDisk() {
  const out = [];
  const walk = (absoluteDir) => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        out.push(path.relative(BACKEND_ROOT, absolutePath).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(BACKEND_ROOT, 'test'));
  return out.sort();
}

/**
 * The `const files = [...]` array literal inside run-tests.mjs. Anchored on the
 * array block specifically so that the explanatory comment above it (which
 * mentions test/db paths in prose) cannot contribute entries.
 */
function parseRegisteredFiles() {
  const source = readFileSync(path.join(BACKEND_ROOT, RUNNER_RELATIVE_PATH), 'utf8');
  const block = source.match(/const files = \[([\s\S]*?)\n\];/);
  assert.ok(
    block,
    `Could not locate the \`const files = [ ... ];\` array in ${RUNNER_RELATIVE_PATH}. ` +
      'If that declaration was renamed or reformatted, update this test to match -- do not delete it.',
  );
  return [...block[1].matchAll(/["']([^"']+\.test\.mjs)["']/g)].map((match) => match[1]);
}

/** Test paths named literally inside a package.json script string. */
function testPathsNamedInScript(scriptName) {
  const packageJson = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
  const script = packageJson.scripts?.[scriptName];
  assert.equal(
    typeof script,
    'string',
    `backend/package.json no longer defines a "${scriptName}" script; this gate reads it to know what CI executes.`,
  );
  return new Set([...script.matchAll(/test\/[\w./-]+\.test\.mjs/g)].map((match) => match[0]));
}

const diskFiles = listTestFilesOnDisk();
const dbFilesOnDisk = diskFiles.filter((file) => file.startsWith('test/db/'));
const nonDbFilesOnDisk = diskFiles.filter((file) => !file.startsWith('test/db/'));

test('this gate can actually read the run-tests.mjs registration list', () => {
  const registered = parseRegisteredFiles();

  // A parse that silently yields nothing would make every assertion below
  // vacuous in the "passing" direction for the reverse check, so pin it.
  assert.ok(
    registered.length > 150,
    `Parsed only ${registered.length} entries from ${RUNNER_RELATIVE_PATH}; expected the full non-DB suite. ` +
      'This almost certainly means the parse broke, not that the suite shrank.',
  );
  assert.equal(new Set(registered).size, registered.length, `${RUNNER_RELATIVE_PATH} lists the same file more than once.`);

  // This file must itself be registered, or the gate does not run either.
  assert.ok(
    registered.includes('test/meta/testSuiteRegistration.test.mjs'),
    `${RUNNER_RELATIVE_PATH} must register test/meta/testSuiteRegistration.test.mjs -- otherwise this gate is itself an orphan.`,
  );
});

test('every non-DB test file on disk is actually executed by `npm test`', () => {
  const registered = new Set(parseRegisteredFiles());
  const runDirectly = testPathsNamedInScript('test');

  const orphans = nonDbFilesOnDisk.filter((file) => !registered.has(file) && !runDirectly.has(file));

  assert.deepEqual(
    orphans,
    [],
    'These test files exist on disk but are NEVER RUN by `npm test`, so they assert nothing:\n' +
      orphans.map((file) => `  - ${file}`).join('\n') +
      `\n\nFix: add each path to the \`files\` array in backend/${RUNNER_RELATIVE_PATH}.`,
  );
});

test('every file registered in run-tests.mjs still exists on disk', () => {
  const onDisk = new Set(nonDbFilesOnDisk);
  const stale = parseRegisteredFiles().filter((file) => !onDisk.has(file));

  assert.deepEqual(
    stale,
    [],
    `These paths are registered in ${RUNNER_RELATIVE_PATH} but no longer exist (renamed or deleted?):\n` +
      stale.map((file) => `  - ${file}`).join('\n'),
  );
});

test('run-tests.mjs registers no DB-backed test (those belong to `npm run test:db`)', () => {
  const misplaced = parseRegisteredFiles().filter((file) => file.startsWith('test/db/'));

  assert.deepEqual(
    misplaced,
    [],
    `${RUNNER_RELATIVE_PATH} runs without a MySQL instance; these DB-backed files must move to package.json's ` +
      '"test:db" script instead:\n' +
      misplaced.map((file) => `  - ${file}`).join('\n'),
  );
});

test('no test file is executed twice by `npm test`', () => {
  const registered = new Set(parseRegisteredFiles());
  const doubled = [...testPathsNamedInScript('test')].filter((file) => registered.has(file));

  assert.deepEqual(
    doubled,
    [],
    'These files are invoked directly by package.json\'s "test" script AND listed in ' +
      `${RUNNER_RELATIVE_PATH}, so they run twice per suite:\n` +
      doubled.map((file) => `  - ${file}`).join('\n'),
  );
});

// The DB suite has exactly the same orphan hole -- its file list is inlined in
// package.json's "test:db" script string. It is in sync today (51/51); this
// keeps it that way. `npm run test:db` needs a MySQL instance and so is not run
// by this suite, but the REGISTRATION check needs no database at all.
test('every DB-backed test file on disk is executed by `npm run test:db`', () => {
  const registeredForDb = testPathsNamedInScript('test:db');
  const orphans = dbFilesOnDisk.filter((file) => !registeredForDb.has(file));

  assert.deepEqual(
    orphans,
    [],
    'These DB-backed test files exist on disk but are NEVER RUN by `npm run test:db`:\n' +
      orphans.map((file) => `  - ${file}`).join('\n') +
      '\n\nFix: add each path to the "test:db" script in backend/package.json.',
  );
});
