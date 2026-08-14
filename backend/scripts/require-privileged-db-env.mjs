// Hard gate for `npm run test:db:platform-admin-privileges` -- the
// mandatory PCA-PA-1 privilege acceptance test. That command is only
// meaningful with BOTH PCA_DATABASE_URL (the least-privilege runtime
// principal under test) and PCA_MIGRATION_DATABASE_URL (a genuinely
// elevated, CREATE-USER/GRANT/REVOKE-capable provisioning credential)
// explicitly set.
//
// Unlike backend/scripts/migrate.mjs / verify-mysql.mjs -- which fall back
// to PCA_DATABASE_URL for ORDINARY schema DDL (CREATE TABLE/ALTER TABLE)
// when PCA_MIGRATION_DATABASE_URL is unset, a reasonable convenience for a
// single local-dev credential that already holds that DDL (see
// backend/scripts/mysql/bootstrap-local.sql) -- this script deliberately
// has NO fallback. CREATE USER/GRANT/REVOKE are a materially more
// privileged class of operation than table DDL, and this command's entire
// purpose is to PROVE the runtime credential does NOT hold them. Silently
// substituting PCA_DATABASE_URL here would either fail confusingly (the
// least-privilege runtime user genuinely cannot CREATE USER) or, worse,
// mask a misconfiguration where the "runtime" URL actually points at an
// over-privileged account -- so this exits non-zero immediately, before any
// build/test step runs, rather than letting the privilege test itself
// discover the problem (or silently skip it -- see
// backend/test/db/platformAdminAuditPrivileges.mysql.test.mjs's own
// standard-vs-privileged mode split for why a SKIP is the correct behavior
// in `npm run test:db`, but never in this dedicated command).
let failed = false;

if (!process.env.PCA_DATABASE_URL) {
  console.error('PCA_DATABASE_URL is required (the least-privilege runtime principal under test).');
  failed = true;
}

if (!process.env.PCA_MIGRATION_DATABASE_URL) {
  console.error(
    'PCA_MIGRATION_DATABASE_URL is required for the mandatory PCA-PA-1 privilege acceptance gate ' +
      '(npm run test:db:platform-admin-privileges). This command intentionally does NOT fall back to ' +
      'PCA_DATABASE_URL for CREATE USER/GRANT/REVOKE operations. Set PCA_MIGRATION_DATABASE_URL to an ' +
      'admin/provisioning-capable connection, or run `npm run test:db` for ordinary regression (which ' +
      'visibly skips this privileged check when PCA_MIGRATION_DATABASE_URL is absent).',
  );
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Privileged DB environment present -- proceeding to the mandatory privilege acceptance gate.');
}
