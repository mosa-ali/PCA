// PCA-DW-W2-2A -- proves Invoke-RepositoryChecks.ps1's top-level allowlist
// fix (adding '.dockerignore', 'database', 'docker-compose.yml' -- files
// that legitimately exist in this repository today but were missing from
// the allowlist, causing 8 false-positive failures) against the REAL
// script and REAL repository data, and proves the allowlist check is not
// vacuously satisfied: a genuinely disallowed top-level path is still
// caught. The negative control briefly registers one throwaway path in the
// git index via `git add -N` (intent-to-add, so `git ls-files` lists it
// with no real content written) and ALWAYS unregisters it and deletes the
// working-tree file in a `finally`, verified by `git status --short`
// showing no trace of it afterward -- safe to re-run at any time.
//
// Usage: node tooling/repo-checks/Test-RepositoryChecks.mjs
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const scriptPath = join(repoRoot, 'tooling', 'repo-checks', 'Invoke-RepositoryChecks.ps1');

try {
  execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore' });
} catch (err) {
  console.error(`FATAL: 'pwsh' (PowerShell 7+) is required to run this suite and could not be invoked (${err.message}).`);
  process.exit(1);
}

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures += 1; }
}

function runScript() {
  try {
    const stdout = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: typeof err.status === 'number' ? err.status : 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

// --- Positive: the real, current repository state must pass. ---
{
  const result = runScript();
  ok(result.exitCode === 0, 'the real repository currently passes Invoke-RepositoryChecks.ps1 (proves the allowlist fix -- .dockerignore/database/docker-compose.yml are no longer false positives)');
  ok(!/unexpected top-level tracked path/.test(result.output), 'no "unexpected top-level tracked path" violation is reported against the real repository');
}

// --- Negative control: a genuinely disallowed top-level path must still fail the check. ---
const scratchName = 'PCA_REPOSITORY_CHECK_NEGATIVE_CONTROL_SCRATCH.tmp';
const scratchPath = join(repoRoot, scratchName);
let scratchRegistered = false;
try {
  writeFileSync(scratchPath, 'negative-control scratch file -- always deleted by the test that created it\n', 'utf8');
  execFileSync('git', ['-C', repoRoot, 'add', '-N', '--', scratchName], { stdio: 'ignore' });
  scratchRegistered = true;

  const result = runScript();
  ok(result.exitCode !== 0, 'NEGATIVE CONTROL: a genuinely disallowed top-level tracked path makes the check FAIL (not vacuously green)');
  ok(result.output.includes(`unexpected top-level tracked path: ${scratchName}`), 'NEGATIVE CONTROL: the failure message names the actual offending path');
} finally {
  if (scratchRegistered) {
    try { execFileSync('git', ['-C', repoRoot, 'reset', '--', scratchName], { stdio: 'ignore' }); } catch { /* best effort */ }
  }
  if (existsSync(scratchPath)) rmSync(scratchPath);
  const statusAfter = execFileSync('git', ['-C', repoRoot, 'status', '--short', '--', scratchName], { cwd: repoRoot, encoding: 'utf8' });
  ok(statusAfter.trim().length === 0, 'CLEANUP VERIFIED: the negative-control scratch path leaves no trace in git status afterward');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll Invoke-RepositoryChecks.ps1 assertions passed.');
