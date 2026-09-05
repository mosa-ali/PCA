/**
 * RELEASE IDENTITY
 *
 * Answers one question the release process must never have to guess:
 * **which bytes are running?**
 *
 * A tag alone cannot answer it. `latest` moves, and even a version tag can be
 * re-pointed after review, so "the reviewed image is deployed" ends up resting
 * on trust rather than evidence. This prints the three identities that together
 * make it checkable, and refuses to produce a release identity from a dirty or
 * unknown tree:
 *
 *   SOURCE_SHA       the commit the artifact was built from
 *   ARTIFACT_SHA256  a rollup of the SHA-256 of every shipped file, computed by
 *                    deploy/manifest.mjs -- this is what makes the build's
 *                    determinism auditable, because the same commit must always
 *                    produce the same value
 *   IMAGE_DIGEST     the immutable content address of the image itself
 *
 * The recommended tag is derived from the source SHA, never `latest`.
 *
 * Usage:
 *   node deploy/release-identity.mjs               # from the working tree
 *   node deploy/release-identity.mjs --image pca-public:local
 */

import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const REGISTRY = 'pcasafe.azurecr.io';
const REPOSITORY = 'pca-public';

const imageArg = process.argv.indexOf('--image');
const image = imageArg === -1 ? null : process.argv[imageArg + 1];

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const sha = git('rev-parse', 'HEAD');
const shortSha = sha ? sha.slice(0, 12) : null;
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

/**
 * Dirty means the artifact does not correspond to any commit, so no release
 * identity can be honest about it. Only paths that affect the artifact count --
 * an edited report does not change a single shipped byte.
 */
const ARTIFACT_PATHS = ['public-web/src', 'public-web/build.mjs', 'public-web/deploy', 'docs/public/PCA_PUBLIC_CLAIM_REGISTER.csv'];
const dirty = git('status', '--porcelain', '--', ...ARTIFACT_PATHS);
const isDirty = Boolean(dirty);

let artifactSha256 = null;
let fileCount = null;
let totalBytes = null;
const manifestPath = join(ROOT, 'reports/MANIFEST.sha256');
try {
  await access(manifestPath);
  const manifest = await readFile(manifestPath, 'utf8');
  artifactSha256 = /# artifact-sha256: ([0-9a-f]{64})/.exec(manifest)?.[1] ?? null;
  fileCount = /# files: (\d+)/.exec(manifest)?.[1] ?? null;
  totalBytes = /bytes: (\d+)/.exec(manifest)?.[1] ?? null;
} catch {
  // No local manifest: run `node deploy/manifest.mjs` after a build.
}

let imageDigest = null;
let imageId = null;
if (image) {
  try {
    const out = execFileSync(
      'docker',
      ['image', 'inspect', image, '--format', '{{.Id}}|{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}'],
      { encoding: 'utf8' }
    ).trim();
    [imageId, imageDigest] = out.split('|');
  } catch {
    imageDigest = null;
  }
}

const releaseTag = shortSha ? `${REGISTRY}/${REPOSITORY}:sha-${shortSha}` : null;

console.log('RELEASE IDENTITY');
console.log(`  SOURCE_SHA        ${sha ?? '(not a git checkout)'}`);
console.log(`  branch            ${branch ?? '-'}`);
console.log(`  tree state        ${isDirty ? 'DIRTY — artifact paths modified' : 'clean'}`);
console.log(`  ARTIFACT_SHA256   ${artifactSha256 ?? '(run: node deploy/manifest.mjs)'}`);
if (fileCount) console.log(`  artifact          ${fileCount} file(s), ${totalBytes} B`);
console.log(`  IMAGE_ID          ${imageId ?? '(pass --image <ref>)'}`);
console.log(`  IMAGE_DIGEST      ${imageDigest || '(none — image has never been pushed to a registry)'}`);
console.log('');
console.log('  IMAGE_TAG_RECOMMENDATION');
console.log(`      ${releaseTag ?? '(needs a commit)'}`);
console.log('      Immutable and traceable: the tag names the commit, so "which bytes are');
console.log('      running?" is answerable from the tag alone. Never deploy `:latest` --');
console.log('      a moving tag makes that question unanswerable and rollback a guess.');
console.log('');
console.log('  ROLLBACK_IMAGE_REFERENCE');
console.log('      pcasafe.azurecr.io/pca-public-placeholder:hold-v1');
console.log('      The image currently on pcaSafe. Record its digest before the first');
console.log('      deploy; a tag is not a rollback target.');

if (isDirty) {
  console.error('');
  console.error('REFUSING TO ISSUE A RELEASE IDENTITY: artifact paths are modified.');
  console.error('A release identity must name a commit. Modified paths:');
  for (const line of dirty.split('\n')) console.error('  ' + line);
  console.error('');
  process.exitCode = 1;
}
