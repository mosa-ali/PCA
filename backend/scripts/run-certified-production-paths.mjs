// PCA_PRODUCTION_PATH_CERTIFICATION -- the EMPIRICAL half of the control.
//
// Enforces, by OBSERVATION rather than by static inspection:
//
//   gate 5  SKIP_COUNT = 0 for the certified scope
//   gate 6  ORDER_DEPENDENT_TEST = FORBIDDEN
//   gate 7  EMPTY_TABLE_DEPENDENCY = FORBIDDEN
//
// It runs every certified test file against the database IN WHATEVER STATE IT IS
// ALREADY IN -- deliberately NOT after a reset, and normally after the full DB
// suite has already populated it. That is the whole mechanism:
//
//   * a test that only passes because a table was near-empty fails here, because
//     the table is not near-empty;
//   * a test that depends on being the only writer, or on its row landing inside
//     the newest N by a global ordering, fails here for the same reason;
//   * a test that silently reports itself skipped fails here, because the skip
//     count is asserted to be zero rather than inferred from the source.
//
// Both properties are exactly what a static check cannot establish, and both
// have already bitten this repository for real: the platform-admin audit row
// read-back passed alone and failed in the full suite (it selected a fixed past
// instant through `ORDER BY occurred_at DESC LIMIT 50`), and the platform-admin
// audit privilege gate asserted nothing in CI for its entire existence because
// it reported itself skipped there.
//
// It deliberately FAILS rather than skips when the privilege credential is
// absent: for the certified scope a missing credential means the certification
// cannot be performed, and "could not certify" must never render as "certified".
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { evaluateCertificationRun } from './lib/certificationRunVerdict.mjs';

const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url));

// THE SINGLE SOURCE OF TRUTH for the certified scope. Certifying a store means
// adding its test file here; test/tooling/productionPathCertification.test.mjs
// cross-checks this list against its own CERTIFIED rows, so the two cannot drift.
const CERTIFIED_FILES = [
  'test/db/actionIdempotency.mysql.test.mjs',
  'test/db/platformAdminAuditPrivileges.mysql.test.mjs',
  'test/db/auth.mysql.test.mjs',
  'test/db/authz.mysql.test.mjs',
  'test/db/parentAccount.mysql.test.mjs',
  'test/db/invitation.mysql.test.mjs',
  'test/db/relay.mysql.test.mjs',
  'test/db/release.mysql.test.mjs',
  'test/db/device.mysql.test.mjs',
  'test/db/enrollment.mysql.test.mjs',
  'test/db/childProfileInvitationBindingHttp.mysql.test.mjs',
  'test/db/eyeProtectionSettingsHttp.mysql.test.mjs',
  'test/db/platformEntitlementsCore.mysql.test.mjs',
  'test/db/complimentaryGrants.mysql.test.mjs',
  'test/db/freeAccessEnforcement.mysql.test.mjs',
  'test/db/settlement.mysql.test.mjs',
  'test/db/platformAdminBootstrap.mysql.test.mjs',
  'test/db/platformadmin.mysql.test.mjs',
  // Added with the MySqlPlatformAdminAlertAdapter promotion (PCA-DEC-033 burn-down):
  // the row's real-writer test lives here, so this file must be executed by CI
  // (gate 6) and re-run against a POPULATED database (gate 7) for the
  // certification to mean anything.
  'test/db/platformAdminAlerts.mysql.test.mjs',
  'test/db/commercialMaintenance.mysql.test.mjs',
  // Added with the MySqlParentMfaRepository row (PCA-DEC-037 Parent MFA).
  'test/db/parentMfa.mysql.test.mjs',
];

if (CERTIFIED_FILES.length === 0) {
  console.error('CERTIFIED_FILES is empty -- refusing to certify nothing.');
  process.exit(1);
}

if (!process.env.PCA_MIGRATION_DATABASE_URL) {
  console.error(
    'PCA_MIGRATION_DATABASE_URL is required: the certified scope includes the platform-admin audit privilege gate, ' +
      'which needs a CREATE-USER-capable connection. Without it those cases would report themselves skipped, and a ' +
      'skipped certification is not a certification.',
  );
  process.exit(1);
}

console.log(
  `Certified production-path scope: ${CERTIFIED_FILES.length} file(s), run against the database AS-IS (populated, not reset):\n` +
    CERTIFIED_FILES.map((file) => `  - ${file}`).join('\n'),
);

const result = spawnSync(
  process.execPath,
  ['--env-file=test.env', '--env-file=test.db.env', '--test', '--test-concurrency=1', ...CERTIFIED_FILES],
  { cwd: BACKEND_ROOT, encoding: 'utf8' },
);
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(output);

const { problems, passed, skipped, failed } = evaluateCertificationRun({ output, exitStatus: result.status });

if (problems.length > 0) {
  console.error(`\nPRODUCTION PATH CERTIFICATION FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `\nPRODUCTION PATH CERTIFICATION PASSED: ${passed} certified test(s) passed against a populated database, ` +
    `${skipped} skipped, ${failed} failed.`,
);
