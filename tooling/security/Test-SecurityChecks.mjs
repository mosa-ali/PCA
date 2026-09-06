// PCA-DW-W2-2B -- proves Invoke-SecurityChecks.ps1's comment-stripping fix
// for the sensitive-logging detector (Get-CodeProjection now discards
// // and /* ... */ comment content, not just string-literal content) against
// an ISOLATED, throwaway git repository seeded with fixture files -- never
// against this repository's own real files or git index, since
// Invoke-SecurityChecks.ps1 already accepts a -RepositoryRoot override for
// exactly this purpose. The temp directory is always removed in a `finally`.
//
// Fixtures cover:
//   1. The exact real false positive this fixes (a single-line JSDoc comment
//      ending "...not a log." and later mentioning a sensitive path/word in
//      plain English) -- must PASS.
//   2. The same shape split across a MULTI-LINE /* ... */ block comment --
//      must also PASS (comment-state must thread across lines correctly).
//   3. NEGATIVE CONTROL: a genuine, real `console.log(child.token)`-shaped
//      call OUTSIDE any comment or string -- must still FAIL. Without this,
//      "make the false positive go away" could regress to "stop detecting
//      real sensitive-logging sinks entirely".
//   4. A real call SHAPE that only appears commented-out (inert, never
//      executes) -- must PASS, mirroring how a string literal's contents
//      are already exempt.
//   5. NEGATIVE CONTROL (PCA-DW-W2-2B-R1): a genuinely executable
//      console.log(child.token) call hidden inside a template-literal
//      ${...} interpolation that itself contains a nested string with an
//      unbalanced '}' -- must still FAIL. A real, verified bypass existed
//      here: Get-CodeProjection's ${...} brace-depth counter was not
//      quote-aware, so a nested string's own '}' character could end
//      interpolation capture early, silently discarding the real call that
//      followed before the detector's regex ever ran.
//   6. NEGATIVE CONTROL (PCA-DW-W2-R1-11): a genuinely executable
//      console.log(child.token) call hidden inside a template-literal
//      ${...} interpolation that itself contains a NESTED backtick
//      template literal (rather than a nested '/"' string) whose own body
//      text contains an unbalanced '}' -- must still FAIL. This is the
//      residual gap #5's own fix explicitly documented as still open
//      ("a nested backtick template literal inside ${...} remains
//      unhandled"); reproduced against the pre-fix scanner (confirmed a
//      real bypass: the call silently vanished from the projection) before
//      Read-TemplateLiteral/Read-TemplateInterpolation closed it.
//   7. NEGATIVE CONTROL (PCA-DW-W3-O): a genuine console.error(child.token)
//      call -- not console.log -- must still FAIL. A real, verified bypass
//      existed here: the old $SensitiveLoggingCallPattern's `console\.`
//      branch relied entirely on a shared trailing '\s*[.(]' requirement
//      that only happens to close for .log( (caught incidentally via the
//      separate bare "Log" alternative), never for .error/.warn/.info/
//      .debug/.trace( despite this file's own prior comment claiming
//      otherwise -- confirmed empirically before the fix
//      ('console.error(x)' did not match the old pattern at all).
//   8. NEGATIVE CONTROL (PCA-DW-W3-O): a genuine
//      console['log'](child.token) call (bracket-notation member access)
//      must still FAIL. A real, verified bypass existed here:
//      Get-CodeProjection correctly strips the quoted 'log' literal's
//      CONTENT (matching its own string-literal handling elsewhere), which
//      left neither a literal '.' nor the substring "log" in the
//      projection for the old pattern to match on, silently hiding the
//      real call.
//   9. NEGATIVE CONTROL (PCA-DW-W3 adversarial review): a genuine
//      console?.error(child.token) call (optional chaining on the member
//      access) must still FAIL. A real, verified residual bypass existed
//      here after item 7's own fix: the `console` sub-alternation required
//      `console` to be followed immediately (mod whitespace) by a literal
//      '.' or '[', and a '?' before either broke both branches.
//  10. NEGATIVE CONTROL (PCA-DW-W3 adversarial review): a genuine
//      console.error?.(child.token) call (optional chaining on the CALL
//      itself, after a normal, non-optional member access) must still
//      FAIL -- the same class of gap as item 9, on the other side of the
//      member name.
//
// Usage: node tooling/security/Test-SecurityChecks.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const scriptPath = join(repoRoot, 'tooling', 'security', 'Invoke-SecurityChecks.ps1');

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

const fixtureRoot = mkdtempSync(join(tmpdir(), 'pca-security-checks-fixture-'));

function git(args) {
  execFileSync('git', args, { cwd: fixtureRoot, stdio: 'ignore' });
}

function runScriptAgainstFixture() {
  try {
    const stdout = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-RepositoryRoot', fixtureRoot], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: typeof err.status === 'number' ? err.status : 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

try {
  git(['init', '--quiet']);
  git(['config', 'user.email', 'pca-security-checks-fixture@example.invalid']);
  git(['config', 'user.name', 'PCA Security Checks Fixture']);

  writeFileSync(
    join(fixtureRoot, 'single-line-jsdoc-false-positive.ts'),
    "/** Enough to be a glance, not a log. The full log lives at /children/:childId/activity. */\nexport const ACTIVITY_PREVIEW_LIMIT = 8;\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'multi-line-block-comment-false-positive.ts'),
    [
      '/**',
      ' * Enough to be a glance, not a log.',
      ' * The full log lives at /children/:childId/activity.',
      ' */',
      'export const OTHER_LIMIT = 8;',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'genuine-sensitive-logging-sink.ts'),
    "function reportChild(child) {\n  console.log('child token', child.token);\n}\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'commented-out-call-is-inert.ts'),
    "// console.log('child token', child.token);\nexport const NOOP = 1;\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'template-literal-brace-depth-bypass.ts'),
    "const a = `${('}' , console.log(child.token))}`;\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'nested-template-literal-brace-depth-bypass.ts'),
    "const a = `${(function(){ return `}`; })(), console.log(child.token)}`;\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'console-error-method-not-just-log.ts'),
    "function reportChild(child) {\n  console.error('child token', child.token);\n}\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'console-bracket-notation-bypass.ts'),
    "function reportChild(child) {\n  console['log']('child token', child.token);\n}\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'console-optional-chaining-bypass.ts'),
    "function reportChild(child) {\n  console?.error('child token', child.token);\n}\n",
    'utf8',
  );

  writeFileSync(
    join(fixtureRoot, 'console-optional-chaining-call-bypass.ts'),
    "function reportChild(child) {\n  console.error?.('child token', child.token);\n}\n",
    'utf8',
  );

  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'fixture files']);

  const result = runScriptAgainstFixture();

  ok(result.exitCode !== 0, 'the fixture repo fails overall (the genuine sensitive-logging sink must still be caught)');
  ok(!result.output.includes('single-line-jsdoc-false-positive.ts'), 'FIX: a single-line JSDoc comment ending "...not a log." is no longer a false positive');
  ok(!result.output.includes('multi-line-block-comment-false-positive.ts'), 'FIX: the same shape split across a multi-line /* ... */ block comment is also no longer a false positive (comment state threads across lines)');
  ok(result.output.includes('genuine-sensitive-logging-sink.ts'), 'NEGATIVE CONTROL: a genuine console.log(child.token) call outside any comment/string is still caught');
  ok(!result.output.includes('commented-out-call-is-inert.ts'), 'a real call shape that only appears commented-out (inert, never executes) is not flagged');
  ok(result.output.includes('template-literal-brace-depth-bypass.ts'), 'NEGATIVE CONTROL: a real console.log(child.token) call hidden behind a nested-string brace-depth trick inside ${...} is still caught');
  ok(result.output.includes('nested-template-literal-brace-depth-bypass.ts'), 'NEGATIVE CONTROL: a real console.log(child.token) call hidden behind a nested-TEMPLATE-LITERAL brace-depth trick inside ${...} is still caught');
  ok(result.output.includes('console-error-method-not-just-log.ts'), 'NEGATIVE CONTROL (PCA-DW-W3-O): console.error(child.token) -- not just console.log -- is caught');
  ok(result.output.includes('console-bracket-notation-bypass.ts'), 'NEGATIVE CONTROL (PCA-DW-W3-O): console[\'log\'](child.token) bracket-notation access is caught');
  ok(result.output.includes('console-optional-chaining-bypass.ts'), 'NEGATIVE CONTROL (PCA-DW-W3 adversarial review): console?.error(child.token) optional chaining on the member access is caught');
  ok(result.output.includes('console-optional-chaining-call-bypass.ts'), 'NEGATIVE CONTROL (PCA-DW-W3 adversarial review): console.error?.(child.token) optional chaining on the call itself is caught');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll Invoke-SecurityChecks.ps1 sensitive-logging comment-awareness assertions passed.');
