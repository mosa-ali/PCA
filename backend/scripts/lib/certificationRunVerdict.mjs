// PCA_PRODUCTION_PATH_CERTIFICATION -- the VERDICT function for the empirical half
// of the control, extracted from scripts/run-certified-production-paths.mjs so it
// can be tested directly.
//
// WHY THIS IS A SEPARATE MODULE. The permanent principle is that an enforcement
// gate must itself be demonstrated to fail on the defect class it claims to
// prevent. When this verdict logic lived inline in the runner, the only way to
// exercise it was to arrange for a real certified test to really skip or really
// fail -- so the two verdicts that matter most (SKIP_COUNT != 0 and FAIL_COUNT !=
// 0) were themselves unverified, and an inversion or an off-by-one in them would
// have rendered the runner permanently green with nothing to catch it. Extracting
// it makes those verdicts attackable with synthetic runner output, which is what
// test/tooling/productionPathCertification.test.mjs now does.
//
// It is deliberately PURE: it takes the captured output and the exit status, and
// returns the verdict. No process.exit, no I/O, no environment.

/**
 * Evaluate one run of the certified production-path scope.
 *
 * @param {{ output: string, exitStatus: number | null }} run
 * @returns {{ problems: string[], passed: number | null, skipped: number | null, failed: number | null }}
 */
export function evaluateCertificationRun({ output, exitStatus }) {
  const summary = (label) => {
    const match = String(output ?? '').match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const skipped = summary('skipped');
  const failed = summary('fail');
  const passed = summary('pass');

  const problems = [];
  if (skipped === null || failed === null || passed === null) {
    // Refusing to infer success from unparseable output. A runner that crashed
    // before printing its summary must read as "could not certify", never as
    // "certified", because the absent counts are indistinguishable from zeros
    // to any check that is not written to notice.
    problems.push('could not read the runner summary -- refusing to infer success from unparseable output');
  } else {
    if (skipped !== 0) problems.push(`${skipped} certified test(s) reported themselves SKIPPED (gate 5 requires 0)`);
    if (failed !== 0) problems.push(`${failed} certified test(s) FAILED`);
    if (passed === 0) problems.push('zero certified tests passed -- an empty pass is not a certification');
  }
  if (exitStatus !== 0 && problems.length === 0) problems.push(`the test runner exited ${exitStatus}`);

  return { problems, passed, skipped, failed };
}
