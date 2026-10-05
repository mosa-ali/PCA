/**
 * Validate the optional, owner-supplied Android Digital Asset Links statement.
 *
 * There is intentionally no checked-in statement until the production signing
 * certificate fingerprint is confirmed. A missing source file means the public
 * route stays a hard 404; malformed or incorrectly scoped input fails the build.
 */

const APP_PACKAGE = 'org.pca.app';
const REQUIRED_RELATION = 'delegate_permission/common.handle_all_urls';
const SHA256_FINGERPRINT = /^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/;

export function validateAndroidAssetLinksManifest(source) {
  let statements;
  try {
    statements = JSON.parse(source);
  } catch {
    throw new Error('assetlinks.json must contain valid JSON.');
  }

  if (!Array.isArray(statements) || statements.length !== 1) {
    throw new Error('assetlinks.json must contain exactly one Android app statement.');
  }

  const statement = statements[0];
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) {
    throw new Error('assetlinks.json statement must be an object.');
  }
  if (Object.keys(statement).sort().join(',') !== 'relation,target') {
    throw new Error('assetlinks.json statement must contain only relation and target.');
  }
  if (!Array.isArray(statement.relation) ||
      statement.relation.length !== 1 ||
      statement.relation[0] !== REQUIRED_RELATION) {
    throw new Error(`assetlinks.json relation must be ${REQUIRED_RELATION}.`);
  }

  const target = statement.target;
  if (!target || typeof target !== 'object' || Array.isArray(target) ||
      Object.keys(target).sort().join(',') !== 'namespace,package_name,sha256_cert_fingerprints') {
    throw new Error('assetlinks.json target must contain the Android namespace, package, and certificate fingerprints.');
  }
  if (target.namespace !== 'android_app' || target.package_name !== APP_PACKAGE) {
    throw new Error(`assetlinks.json must target the Android app ${APP_PACKAGE}.`);
  }
  if (!Array.isArray(target.sha256_cert_fingerprints) ||
      target.sha256_cert_fingerprints.length === 0 ||
      target.sha256_cert_fingerprints.some((value) => typeof value !== 'string' || !SHA256_FINGERPRINT.test(value))) {
    throw new Error('assetlinks.json must contain at least one colon-separated SHA-256 signing-certificate fingerprint.');
  }
  if (new Set(target.sha256_cert_fingerprints.map((value) => value.toUpperCase())).size !== target.sha256_cert_fingerprints.length) {
    throw new Error('assetlinks.json contains a duplicate signing-certificate fingerprint.');
  }

  return `${JSON.stringify(statements, null, 2)}\n`;
}
