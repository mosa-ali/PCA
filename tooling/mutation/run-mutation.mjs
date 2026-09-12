// CURRENT_HEAD_MUTATION runner.
//
// !!! WHAT THIS HARNESS IS AND IS NOT (2026-09-08, real backend execution
// added as part of the engineering closure pass -- see git history for the
// prior static-only version if you need it) !!!
// BACKEND mutants are now classified by REAL EXECUTION: the mutated source
// is compiled (tsc) against a full copy of backend/'s installed dependencies
// and, if it compiles, the entire non-DB backend test suite
// (scripts/run-tests.mjs, the same one `npm test` runs) is executed against
// the mutated build. "KILLED" means an actual test failed or the mutated
// source failed to compile; "SURVIVED" means the real suite passed clean
// against a mutated program. This is genuine mutation testing for backend.
//
// PARENT-WEB and ANDROID mutants are still classified ONLY by the static
// string-assertion scripts check-{parent-web,android}-boundaries.mjs
// (requireText/forbidText over source) -- "KILLED" there still only means "a
// hardcoded string assertion noticed the mutated text changed", not "a test
// failed". Do not cite parent-web/android VALID_MUTATION_SURVIVORS as
// test-strength evidence; see tooling/mutation/README.md. EQUIVALENT/INVALID
// are read from the manifest's expectedClassification only when the mutant's
// own execution doesn't itself prove otherwise (see classifyBackendMutant's
// manifestAnomaly handling below) -- never derived for parent-web/android.
// The report's `executesTests`/`classificationMethod` fields are now
// per-surface so a reader can't mistake one surface's method for another's.
//
// It copies each package to a temporary directory, applies one declared
// source mutation there, and runs the bounded tests against that copy. The
// entry worktree is read-only from this script's perspective: no production
// source, central ledger, release validator, migration, buildServer/main, or
// feature source is ever edited in the real checkout.
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLING_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOPE_PATH = path.join(TOOLING_ROOT, 'tooling', 'mutation', 'mutation-scope.json');
const REPORT_PATH = path.join(TOOLING_ROOT, 'tooling', 'mutation', 'reports', 'current-head-mutation.json');
const scope = JSON.parse(await readFile(SCOPE_PATH, 'utf8'));
const PROVENANCE_MODEL = 'SOURCE_FINGERPRINT_V1_WITH_SEPARATE_EVIDENCE_HEAD';
const MUTATION_INPUT_ROOTS = [
  'backend/',
  'parent-web/',
  'parent-sdk/',
  'android/',
  'contracts/',
  'platform-admin-web/',
  'tooling/',
  'docs/',
];
const MUTATION_INPUT_EXCLUDED_PREFIXES = [
  'docs/supervision/',
  'tooling/mutation/reports/',
];

const allowedHarnessRoots = [
  'backend/test/mutation/',
  'parent-web/tests/mutation/',
  'android/app/src/test/java/org/pca/app/mutation/',
  'tooling/mutation/',
];
const validClassifications = new Set(['KILLED', 'EQUIVALENT', 'INVALID', 'SURVIVED']);

function fail(message) {
  throw new Error(`mutation configuration error: ${message}`);
}

function sha256(parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function mutationInputPaths() {
  const result = await run(
    'git',
    ['-C', TOOLING_ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...MUTATION_INPUT_ROOTS],
    TOOLING_ROOT,
  );
  if (result.code !== 0) fail(`git ls-files failed while building mutation provenance: ${shortOutput(result)}`);
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => !MUTATION_INPUT_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .sort();
}

async function fingerprintFiles(files) {
  const parts = [];
  for (const file of files) {
    const contents = await readFile(path.join(TOOLING_ROOT, file));
    parts.push(file, contents);
  }
  return sha256(parts);
}

async function mutationProvenance() {
  const inputPaths = await mutationInputPaths();
  const scopePath = path.relative(TOOLING_ROOT, SCOPE_PATH).replaceAll('\\', '/');
  return {
    sourceFingerprint: await fingerprintFiles(inputPaths),
    sourceFingerprintFileCount: inputPaths.length,
    scopeFingerprint: await fingerprintFiles([scopePath]),
  };
}

function stableClassificationEvidence(report) {
  return {
    counts: report.counts,
    validSurvivors: report.validSurvivors,
    environmentBlock: report.environmentBlock,
    manifestAnomalies: report.manifestAnomalies,
    mutants: report.mutants.map((mutant) => ({
      id: mutant.id,
      requirement: mutant.requirement,
      surface: mutant.surface,
      source: mutant.source,
      expectedClassification: mutant.expectedClassification,
      classification: mutant.classification,
      method: mutant.method,
      checks: mutant.checks,
      manifestAnomaly: mutant.manifestAnomaly,
    })),
  };
}

function classificationDigest(report) {
  return sha256([JSON.stringify(stableClassificationEvidence(report))]);
}

async function readExistingReport() {
  try {
    return JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function canReuseExistingReport(existing, candidate) {
  return Boolean(
    existing &&
    existing.provenanceModel === PROVENANCE_MODEL &&
    existing.sourceFingerprint === candidate.sourceFingerprint &&
    existing.scopeFingerprint === candidate.scopeFingerprint &&
    existing.classificationDigest === candidate.classificationDigest &&
    existing.worktreeCleanAtRun === candidate.worktreeCleanAtRun,
  );
}

function assertScope() {
  if (!/^[0-9a-f]{40}$/i.test(scope.entrySha)) fail('manifest mutation SHA must be a full 40-character commit SHA');
  for (const [requirement, value] of Object.entries(scope.requirements)) {
    if (!value.tests?.length) fail(`${requirement} has no test evidence paths`);
    for (const testPath of value.tests) {
      if (!allowedHarnessRoots.some((root) => testPath.startsWith(root))) {
        fail(`${requirement} points outside permitted harness roots: ${testPath}`);
      }
    }
  }
  for (const mutant of scope.mutants) {
    if (!scope.requirements[mutant.requirement]) fail(`${mutant.id} references an unlisted requirement`);
    if (!mutant.id || !mutant.surface || !mutant.source || typeof mutant.from !== 'string' || typeof mutant.to !== 'string') {
      fail(`${mutant.id ?? '<unnamed>'} is incomplete`);
    }
  }
}

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function shortOutput(result) {
  const text = `${result.stdout}\n${result.stderr}`.replace(/\s+/g, ' ').trim();
  return text.slice(-600);
}

async function gitHead() {
  const result = await run('git', ['-C', TOOLING_ROOT, 'rev-parse', 'HEAD'], TOOLING_ROOT);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function gitWorktreeIsClean() {
  const result = await run('git', ['-C', TOOLING_ROOT, 'status', '--porcelain'], TOOLING_ROOT);
  return result.code === 0 ? result.stdout.trim().length === 0 : null;
}

// The baseline this run is allowed to execute at.
//
// Previously the runner hard-compared HEAD against the manifest's entrySha and
// aborted on any difference. That pin is a hand-edited constant, so the harness
// silently became unrunnable as soon as the branch moved past it -- and it did, by
// 141 commits -- which is how the mutation numbers came to rest on a written table
// with no tool artifact behind them. The equality check itself is correct (a mutation
// result is only meaningful against a stated baseline); what was wrong is that the
// baseline could only ever be changed by editing a file.
//
// So it is now an input:  --baseline <sha> | --baseline=<sha> | --baseline HEAD
// or PCA_MUTATION_BASELINE. With nothing supplied it resolves to the current
// HEAD, so a literal manifest SHA cannot become stale after a later commit.
// The resolved baseline and where it came from are both recorded in the report.
function resolveRequestedBaseline() {
  const args = process.argv.slice(2);
  let requested = process.env.PCA_MUTATION_BASELINE ?? null;
  let source = requested === null ? null : 'PCA_MUTATION_BASELINE';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--baseline') {
      requested = args[index + 1];
      source = '--baseline';
      index += 1;
    } else if (args[index].startsWith('--baseline=')) {
      requested = args[index].slice('--baseline='.length);
      source = '--baseline';
    }
  }
  return { requested, source };
}

async function checkBackend(root) {
  return run('node.exe', [path.join(TOOLING_ROOT, 'tooling', 'mutation', 'check-backend-boundaries.mjs'), root], TOOLING_ROOT);
}

async function copyBackend(tempRoot) {
  const destination = path.join(tempRoot, 'backend');
  await cp(path.join(TOOLING_ROOT, 'backend'), destination, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}dist${path.sep}`),
  });
  // Real build+test execution (classifyBackendMutant below) needs backend's
  // installed dependencies (tsc, everything the test files import). These
  // are never mutated by any mutant, so link rather than copy them (tens of
  // MB, unchanged) into the temp copy -- a Windows junction needs no
  // elevated privileges, unlike a symlink. The cp() filter above excludes
  // node_modules' CONTENTS (every child path contains the separator on both
  // sides) but not the empty node_modules directory entry itself, which cp
  // still creates -- remove that stub first or the link creation below
  // fails with EEXIST.
  const linkedNodeModules = path.join(destination, 'node_modules');
  await rm(linkedNodeModules, { recursive: true, force: true });
  await symlink(
    path.join(TOOLING_ROOT, 'backend', 'node_modules'),
    linkedNodeModules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const baseline = await checkBackend(destination);
  if (baseline.code !== 0) throw new Error(`backend baseline static checks blocked: ${shortOutput(baseline)}`);
  const build = await buildBackend(destination);
  if (build.code !== 0) throw new Error(`backend baseline (unmutated) failed to compile: ${shortOutput(build)}`);
  return destination;
}

/** Compiles the (possibly mutated) TypeScript copy at `root` -- exactly what `npm run build` does, run directly against the linked-in compiler so no npm/shell wrapper is needed. */
async function buildBackend(root) {
  return run('node.exe', [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')], root);
}

/** Runs the exact non-DB suite `npm test` runs (scripts/run-tests.mjs), against the (possibly mutated, already-built) copy at `root`. No live database is needed -- this is the same file list `npm test` spawns via scripts/run-tests.mjs, none of which are *.mysql.test.mjs. */
async function runBackendRealTests(root) {
  return run('node.exe', ['--env-file=test.env', path.join('scripts', 'run-tests.mjs')], root);
}

/**
 * Extracts the set of failing test names from node's `--test` TAP-ish
 * output (`not ok <n> - <name>`), keyed by name rather than the numeric
 * index (stable across runs; the index is not, if a file's own internal
 * subtest count ever shifts).
 */
function parseFailingTestNames(output) {
  const names = new Set();
  const pattern = /^not ok \d+ - (.+)$/gm;
  let match;
  while ((match = pattern.exec(output)) !== null) names.add(match[1].trim());
  return names;
}

/**
 * A handful of backend non-DB tests are genuine cross-package invariant
 * checks that reach outside anything this harness can put in a throwaway
 * temp copy -- most concretely, test/tooling/RebuildR3DerivedLedgers.test.mjs
 * calls `git rev-parse HEAD` unconditionally (RebuildR3DerivedLedgers.mjs's
 * own drift-detection feature), which fails 100% of the time in a temp
 * directory that was never `git init`-ed (deliberately -- copying .git would
 * be pointless for a scratch copy). This is a deterministic ENVIRONMENTAL
 * gap, discovered by this harness's own first real run, not flakiness and
 * not something any mutation could ever cause or fix.
 *
 * Rather than special-case that one script, run the real suite ONCE against
 * the pristine (unmutated) copy right after setup and record which test
 * names already fail there. Every per-mutant classification then diffs its
 * own failing-test set against this baseline: only NEW failures (present
 * after mutation, absent from the baseline) count as a kill. A mutant that
 * merely coexists with the same pre-existing environmental failures did not
 * get exercised by them and must not be credited with killing anything.
 */
async function establishBackendTestBaseline(root) {
  const result = await runBackendRealTests(root);
  const failing = parseFailingTestNames(`${result.stdout}\n${result.stderr}`);
  return { code: result.code, failing, evidence: shortOutput(result) };
}

/**
 * Real mutation classification for a backend mutant, at `root` (a temp copy
 * with `mutant.source` already overwritten with the mutated text -- see
 * classify() below). Build first: a mutant that doesn't compile is KILLED
 * (or INVALID, if the manifest declared it should never compile) without
 * ever running the test suite. A mutant that compiles is run against the
 * real non-DB suite; a test failure is KILLED, a clean pass is SURVIVED (or
 * EQUIVALENT, if the manifest declared the mutation semantically inert).
 *
 * manifestAnomaly is set whenever the mutant's own real execution
 * contradicts what mutation-scope.json declared (e.g. a mutant marked
 * EQUIVALENT that the real suite actually kills, or one marked INVALID that
 * actually compiles) -- this harness can now detect that class of error,
 * which the old string-assertion-only version structurally could not, since
 * it never ran anything capable of contradicting the manifest.
 */
async function classifyBackendMutant(root, mutant, testBaseline) {
  const declaredInvalid = mutant.expectedClassification === 'INVALID';
  const declaredEquivalent = mutant.expectedClassification === 'EQUIVALENT';

  const build = await buildBackend(root);
  if (build.code !== 0) {
    if (declaredInvalid) {
      return { classification: 'INVALID', method: 'real-tsc-compile', evidence: shortOutput(build) };
    }
    const result = { classification: 'KILLED', method: 'real-tsc-compile-error', evidence: shortOutput(build) };
    if (declaredEquivalent) result.manifestAnomaly = 'declared EQUIVALENT but the mutated source failed to compile';
    return result;
  }
  if (declaredInvalid) {
    return {
      classification: 'SURVIVED',
      method: 'real-tsc-compile',
      evidence: shortOutput(build),
      manifestAnomaly: 'declared INVALID but the mutated source compiled successfully',
    };
  }

  const tests = await runBackendRealTests(root);
  const failingNow = parseFailingTestNames(`${tests.stdout}\n${tests.stderr}`);
  const newFailures = [...failingNow].filter((name) => !testBaseline.failing.has(name));
  if (newFailures.length > 0) {
    const result = {
      classification: 'KILLED',
      method: 'real-test-suite-execution',
      evidence: `NEW failures beyond the environmental baseline: ${newFailures.join(' | ')}`,
    };
    if (declaredEquivalent) result.manifestAnomaly = 'declared EQUIVALENT but the real backend test suite failed against this mutant (beyond the environmental baseline)';
    return result;
  }
  // tests.code may still be non-zero here (the same pre-existing baseline
  // failures reproduced, e.g. RebuildR3DerivedLedgers' git-repo dependency)
  // -- that is not evidence this mutant did anything, so it is not KILLED.
  return {
    classification: declaredEquivalent ? 'EQUIVALENT' : 'SURVIVED',
    method: 'real-test-suite-execution',
    evidence: shortOutput(tests),
  };
}

async function checkParentWeb(root) {
  return run('node.exe', [path.join(TOOLING_ROOT, 'tooling', 'mutation', 'check-parent-web-boundaries.mjs'), root], TOOLING_ROOT);
}

async function copyParentWeb(tempRoot) {
  const destination = path.join(tempRoot, 'parent-web');
  await cp(path.join(TOOLING_ROOT, 'parent-web'), destination, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}dist${path.sep}`),
  });
  await cp(path.join(TOOLING_ROOT, 'parent-sdk'), path.join(tempRoot, 'parent-sdk'), {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}dist${path.sep}`),
  });
  const baseline = await checkParentWeb(destination);
  if (baseline.code !== 0) throw new Error(`parent-web baseline static checks blocked: ${shortOutput(baseline)}`);
  return destination;
}

async function checkAndroid(root) {
  return run('node.exe', [path.join(TOOLING_ROOT, 'tooling', 'mutation', 'check-android-boundaries.mjs'), root], TOOLING_ROOT);
}

async function copyAndroid(tempRoot) {
  const destination = path.join(tempRoot, 'android');
  await cp(path.join(TOOLING_ROOT, 'android'), destination, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.gradle${path.sep}`) && !source.includes(`${path.sep}build${path.sep}`),
  });
  const baseline = await checkAndroid(destination);
  if (baseline.code !== 0) throw new Error(`android baseline static checks blocked: ${shortOutput(baseline)}`);
  return destination;
}

/**
 * A real backend test run (classifyBackendMutant) needs more than
 * backend/'s own files: several of its non-DB tests are legitimate
 * cross-package invariant checks that read/execute sibling top-level
 * directories by relative path -- e.g.
 * test/scripts/disposableBootstrapArtifact.test.mjs diffs a generator's
 * output against docs/database/bootstrap/*.sql, the runtime-schedule-
 * conformance tests read contracts/schedule-runtime/vectors/*.json,
 * test/tooling/RebuildR3DerivedLedgers.test.mjs executes
 * tooling/release/RebuildR3DerivedLedgers.mjs, and
 * test/security/sdkDisclosure.test.mjs recomputes the SDK disclosure from
 * every package's real manifest, including platform-admin-web's. Without
 * these siblings present at the same relative position, ALL of those tests
 * fail regardless of any mutation -- discovered by this harness's own first
 * real run, which is exactly the class of thing static string-assertions
 * could never have caught. parent-web/parent-sdk and android are already
 * copied as siblings for their own mutants (copyParentWeb/copyAndroid); this
 * fills in the remaining ones backend's tests reach into.
 */
async function copySiblingContext(tempRoot) {
  for (const name of ['docs', 'contracts', 'tooling', 'platform-admin-web']) {
    await cp(path.join(TOOLING_ROOT, name), path.join(tempRoot, name), {
      recursive: true,
      filter: (source) =>
        !source.includes(`${path.sep}node_modules${path.sep}`) &&
        !source.includes(`${path.sep}dist${path.sep}`) &&
        !source.includes(`${path.sep}build${path.sep}`),
    });
  }
}

function mutateText(source, mutant) {
  const normalized = source.replaceAll('\r\n', '\n');
  const occurrences = normalized.split(mutant.from).length - 1;
  if (occurrences !== 1) fail(`${mutant.id} expected one source match, found ${occurrences}`);
  return normalized.replace(mutant.from, mutant.to);
}

async function classify(mutant, context) {
  const sourcePath = path.join(context.root, mutant.source);
  const original = context.originals.get(mutant.source);
  await writeFile(sourcePath, mutateText(original, mutant), 'utf8');
  let result;
  if (mutant.surface === 'backend') {
    result = await classifyBackendMutant(context.root, mutant, context.testBaseline);
  } else if (mutant.surface === 'parent-web') {
    const checks = await checkParentWeb(context.root);
    if (mutant.expectedClassification === 'INVALID') {
      result = { classification: checks.code === 0 ? 'SURVIVED' : 'INVALID', checks: checks.code, evidence: shortOutput(checks), method: 'source-shape invalidity check' };
    } else {
      result = {
        classification: checks.code === 0
          ? (mutant.expectedClassification === 'EQUIVALENT' ? 'EQUIVALENT' : 'SURVIVED')
          : 'KILLED',
        checks: checks.code,
        evidence: shortOutput(checks),
      };
    }
  } else if (mutant.surface === 'android-static') {
    const checks = await checkAndroid(context.root);
    result = {
      classification: mutant.expectedClassification === 'INVALID'
        ? (checks.code === 0 ? 'SURVIVED' : 'INVALID')
        : checks.code === 0
          ? (mutant.expectedClassification === 'EQUIVALENT' ? 'EQUIVALENT' : 'SURVIVED')
          : 'KILLED',
      checks: checks.code,
      evidence: shortOutput(checks),
      ...(mutant.expectedClassification === 'INVALID' ? { method: 'source-shape invalidity check' } : {}),
    };
  } else {
    fail(`${mutant.id} has unknown surface ${mutant.surface}`);
  }
  await writeFile(sourcePath, original, 'utf8');
  return result;
}

assertScope();
const head = await gitHead();
if (head === null) fail('git rev-parse HEAD failed; this runner requires a git worktree');
const { requested: requestedBaseline, source: baselineSource } = resolveRequestedBaseline();
const baseline = requestedBaseline === null
  ? head
  : (/^HEAD$/i.test(requestedBaseline) ? head : requestedBaseline);
if (!/^[0-9a-f]{40}$/i.test(baseline)) {
  fail(`baseline must be a full 40-character commit SHA or the literal HEAD, got ${requestedBaseline}`);
}
if (requestedBaseline !== null && !/^HEAD$/i.test(requestedBaseline) && head.toLowerCase() !== baseline.toLowerCase()) {
  fail(`runner must execute at baseline ${baseline}, found ${head}. Check that commit out, or pass --baseline ${head} / --baseline HEAD to run against the current one.`);
}
const worktreeClean = await gitWorktreeIsClean();
const provenance = await mutationProvenance();

const tempRoot = await (async () => {
  const prefix = path.join(os.tmpdir(), 'pca-r3-current-head-mutation-');
  return import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(prefix));
})();
const contexts = {};
const results = [];
let environmentBlock = null;

try {
  contexts.backend = { root: await copyBackend(tempRoot), originals: new Map() };
  contexts.parentWeb = { root: await copyParentWeb(tempRoot), originals: new Map() };
  contexts.android = { root: await copyAndroid(tempRoot), originals: new Map() };
  // See copySiblingContext's own doc comment: backend's real test execution
  // needs these present as siblings, not just backend/ itself.
  await copySiblingContext(tempRoot);
  // See establishBackendTestBaseline's own doc comment: some non-DB backend
  // tests fail deterministically in ANY throwaway temp copy regardless of
  // mutation (e.g. a git-repo dependency) -- capture that once now so every
  // mutant below is judged against it, not against a phantom "all green"
  // expectation this environment can never actually reach.
  contexts.backend.testBaseline = await establishBackendTestBaseline(contexts.backend.root);

  for (const mutant of scope.mutants) {
    const context = mutant.surface === 'backend'
      ? contexts.backend
      : mutant.surface === 'parent-web'
        ? contexts.parentWeb
        : contexts.android;
    if (!context.originals.has(mutant.source)) {
      context.originals.set(mutant.source, await readFile(path.join(context.root, mutant.source), 'utf8'));
    }
  }

  for (const mutant of scope.mutants) {
    const context = mutant.surface === 'backend'
      ? contexts.backend
      : mutant.surface === 'parent-web'
        ? contexts.parentWeb
        : contexts.android;
    const classification = await classify(mutant, context);
    if (!validClassifications.has(classification.classification)) fail(`${mutant.id} produced unknown classification`);
    results.push({ ...mutant, ...classification });
  }
} catch (error) {
  environmentBlock = error instanceof Error ? error.message : String(error);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

const counts = Object.fromEntries([...validClassifications].map((classification) => [
  classification,
  results.filter((result) => result.classification === classification).length,
]));
const manifestAnomalies = results.filter((result) => result.manifestAnomaly).map(({ id, manifestAnomaly }) => ({ id, manifestAnomaly }));
const report = {
  // See the file header: backend is real execution (build + the actual
  // non-DB test suite); parent-web/android are still the static
  // string-assertion check only. Per-surface, not one blanket claim --
  // downstream ledgers must not read the parent-web/android entries as
  // mutation-testing evidence.
  executesTests: { backend: true, 'parent-web': false, android: false },
  classificationMethod: {
    backend: 'REAL_BUILD_AND_TEST_SUITE_EXECUTION',
    'parent-web': 'STATIC_STRING_ASSERTION_ONLY',
    android: 'STATIC_STRING_ASSERTION_ONLY',
  },
  provenanceModel: PROVENANCE_MODEL,
  mission: scope.mission,
  // `sourceHead` identifies the exact checkout whose mutation inputs were
  // fingerprinted. `invocationHead` identifies the checkout from which this
  // command was invoked. A documentation-only commit may change the latter
  // without changing the tested source tree; in that case the existing report
  // is retained after the full mutation run verifies the same fingerprints and
  // classifications. The evidence-package commit is recorded by the
  // supervision documents, not self-referentially inside this tracked report.
  sourceHead: head,
  invocationHead: head,
  evidenceGeneratedAtHead: head,
  mutationHead: head,
  entrySha: head,
  // How the baseline for this run was chosen, so a reader of the artifact can tell a
  // manifest-pinned run from an explicitly-parameterised one without re-deriving it.
  baseline,
  baselineSource: baselineSource ?? 'current HEAD (default)',
  manifestEntrySha: scope.entrySha,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceFingerprintFileCount: provenance.sourceFingerprintFileCount,
  scopeFingerprint: provenance.scopeFingerprint,
  sourceFingerprintRoots: MUTATION_INPUT_ROOTS,
  sourceFingerprintExcludedPrefixes: MUTATION_INPUT_EXCLUDED_PREFIXES,
  // The runner mutates COPIES of the working tree, not of the commit. A dirty worktree
  // therefore means these results describe HEAD plus uncommitted edits, which is a
  // materially different claim -- record it rather than let the report imply otherwise.
  worktreeCleanAtRun: worktreeClean,
  generatedAtUtc: new Date().toISOString(),
  boundedRequirements: scope.requirements,
  counts,
  validSurvivors: counts.SURVIVED,
  environmentBlock,
  // Non-empty only when a backend mutant's real execution contradicted what
  // mutation-scope.json declared for it (see classifyBackendMutant) -- a
  // manifest correction is needed, not silently trusted.
  manifestAnomalies,
  // See establishBackendTestBaseline's doc comment: tests that fail even
  // against the pristine, unmutated backend copy (a temp-directory
  // environmental limitation, e.g. RebuildR3DerivedLedgers' git-repo
  // dependency -- never a real defect) so every backend mutant's KILLED/
  // SURVIVED verdict above is against NEW failures only, not raw exit code.
  backendTestBaseline: contexts.backend?.testBaseline
    ? { exitCode: contexts.backend.testBaseline.code, preExistingFailures: [...contexts.backend.testBaseline.failing].sort() }
    : null,
  mutationMethod: 'Backend: mutated source is compiled and the real non-DB backend test suite (scripts/run-tests.mjs, the same one `npm test` runs) is executed against it, diffed against a pristine-copy baseline (see backendTestBaseline) so pre-existing environmental failures are never mistaken for a kill -- genuine mutation testing. Parent Web and Android: dependency-free static string-assertion checks over temporary source copies only; native test evidence for those surfaces is run separately and reported with the handoff.',
  mutants: results.map(({ from, to, ...result }) => result),
};
report.classificationDigest = classificationDigest(report);
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
const existingReport = await readExistingReport();
const reportReused = canReuseExistingReport(existingReport, report);
if (!reportReused) await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const persistedReport = reportReused ? existingReport : report;
console.log(JSON.stringify({
  provenanceModel: PROVENANCE_MODEL,
  invocationHead: head,
  sourceHead: persistedReport.sourceHead,
  reportWritten: !reportReused,
  counts,
  validSurvivors: counts.SURVIVED,
  environmentBlock,
  manifestAnomalies,
}));
if (environmentBlock || counts.SURVIVED > 0 || manifestAnomalies.length > 0) process.exitCode = 2;
