// CURRENT_HEAD_MUTATION runner.
//
// It copies each package to a temporary directory, applies one declared
// source mutation there, and runs the bounded tests against that copy. The
// entry worktree is read-only from this script's perspective: no production
// source, central ledger, release validator, migration, buildServer/main, or
// feature source is ever edited in D:/PCA/r3-w93.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLING_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOPE_PATH = path.join(TOOLING_ROOT, 'tooling', 'mutation', 'mutation-scope.json');
const REPORT_PATH = path.join(TOOLING_ROOT, 'tooling', 'mutation', 'reports', 'current-head-mutation.json');
const scope = JSON.parse(await readFile(SCOPE_PATH, 'utf8'));

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
// or PCA_MUTATION_BASELINE. With nothing supplied it still falls back to the
// manifest's entrySha, so the default behaviour is unchanged. The resolved baseline
// and where it came from are both recorded in the report.
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
  const baseline = await checkBackend(destination);
  if (baseline.code !== 0) throw new Error(`backend baseline static checks blocked: ${shortOutput(baseline)}`);
  return destination;
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
    const checks = await checkBackend(context.root);
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
  ? scope.entrySha
  : (/^HEAD$/i.test(requestedBaseline) ? head : requestedBaseline);
if (!/^[0-9a-f]{40}$/i.test(baseline)) {
  fail(`baseline must be a full 40-character commit SHA or the literal HEAD, got ${requestedBaseline}`);
}
if (head.toLowerCase() !== baseline.toLowerCase()) {
  fail(`runner must execute at baseline ${baseline}, found ${head}. Check that commit out, or pass --baseline ${head} / --baseline HEAD to run against the current one.`);
}
const worktreeClean = await gitWorktreeIsClean();

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
const report = {
  mission: scope.mission,
  mutationHead: head,
  entrySha: head,
  // How the baseline for this run was chosen, so a reader of the artifact can tell a
  // manifest-pinned run from an explicitly-parameterised one without re-deriving it.
  baseline,
  baselineSource: baselineSource ?? 'mutation-scope.json:entrySha',
  // The runner mutates COPIES of the working tree, not of the commit. A dirty worktree
  // therefore means these results describe HEAD plus uncommitted edits, which is a
  // materially different claim -- record it rather than let the report imply otherwise.
  worktreeCleanAtRun: worktreeClean,
  generatedAtUtc: new Date().toISOString(),
  boundedRequirements: scope.requirements,
  counts,
  validSurvivors: counts.SURVIVED,
  environmentBlock,
  mutationMethod: 'Dependency-free static checks over temporary source copies; native backend, Parent Web, and Android test evidence is run separately and reported with the handoff.',
  mutants: results.map(({ from, to, ...result }) => result),
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ mutationHead: head, counts, validSurvivors: counts.SURVIVED, environmentBlock }));
if (environmentBlock || counts.SURVIVED > 0) process.exitCode = 2;
